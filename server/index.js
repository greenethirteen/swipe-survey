import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import admin from 'firebase-admin';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const APP_SECRET = process.env.APP_SECRET || 'dev-secret-change-me';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const CLIENT_DIST = path.resolve(__dirname, '../client/dist');
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const firebasePrivateKey = normalizeFirebasePrivateKey(process.env.FIREBASE_PRIVATE_KEY_BASE64 || process.env.FIREBASE_PRIVATE_KEY);

const DIRECTIONS = ['left', 'right', 'up', 'down'];
const DIRECTION_LABELS = {
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down'
};

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));

if (firebaseProjectId && firebaseClientEmail && firebasePrivateKey && !admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: firebaseProjectId,
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey
    })
  });
}

function normalizeFirebasePrivateKey(value) {
  if (!value) return '';
  let key = String(value).trim();
  if (process.env.FIREBASE_PRIVATE_KEY_BASE64 && String(value) === process.env.FIREBASE_PRIVATE_KEY_BASE64) {
    key = Buffer.from(key, 'base64').toString('utf8').trim();
  }
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n').trim();
}

function ensureDb() {
  const folder = path.dirname(DB_FILE);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], surveys: [], responses: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  ensureDb();
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

function id() {
  return crypto.randomUUID();
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(data) {
  return crypto.createHmac('sha256', APP_SECRET).update(data).digest('base64url');
}

function createToken(userId) {
  const payload = {
    userId,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  if (signature !== sign(body)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = stored.split(':');
  const attempted = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(attempted, 'hex'));
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function upsertFirebaseUser(decodedToken) {
  const email = cleanText(decodedToken.email).toLowerCase();
  if (!email || !decodedToken.uid) throw new Error('Firebase token did not include a verified user.');

  const db = readDb();
  let user = db.users.find((item) => item.firebaseUid === decodedToken.uid);
  if (!user) user = db.users.find((item) => item.email === email);

  if (user) {
    user.firebaseUid = decodedToken.uid;
    user.name = user.name || cleanText(decodedToken.name, 'Survey Creator');
    user.email = user.email || email;
    user.updatedAt = new Date().toISOString();
  } else {
    user = {
      id: id(),
      firebaseUid: decodedToken.uid,
      name: cleanText(decodedToken.name, 'Survey Creator'),
      email,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
  }

  writeDb(db);
  return user;
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.query?.token) return String(req.query.token);
  return null;
}

function requireAuth(req, res, next) {
  const payload = verifyToken(getBearerToken(req));
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  const db = readDb();
  const user = db.users.find((item) => item.id === payload.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

function slugify(text) {
  const base = String(text || 'survey')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'survey';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

function cleanText(value, fallback = '') {
  return String(value ?? fallback).trim().replace(/\s+/g, ' ');
}

function fallbackOption(direction, index) {
  const defaults = {
    left: ['No', 'Disagree', 'Never experienced'],
    right: ['Yes', 'Agree', 'Experienced once or more'],
    up: ['Strongly agree', 'Very important', 'Serious / urgent'],
    down: ['Not sure', 'Not applicable', 'Other']
  };
  return defaults[direction][index % defaults[direction].length];
}

function normalizeSurvey(input) {
  const now = new Date().toISOString();
  const title = cleanText(input?.title, 'Untitled swipe survey');
  const description = cleanText(input?.description, 'Answer each question by swiping in one of four directions.');
  const rawQuestions = Array.isArray(input?.questions) ? input.questions : [];

  const questions = rawQuestions.slice(0, 40).map((question, questionIndex) => {
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const optionsByDirection = new Map();

    rawOptions.forEach((option, optionIndex) => {
      const direction = DIRECTIONS.includes(option.direction) ? option.direction : DIRECTIONS[optionIndex % 4];
      if (!optionsByDirection.has(direction)) {
        optionsByDirection.set(direction, {
          id: option.id || id(),
          direction,
          label: cleanText(option.label, fallbackOption(direction, questionIndex)),
          value: cleanText(option.value, option.label || fallbackOption(direction, questionIndex))
        });
      }
    });

    const options = DIRECTIONS.map((direction) => optionsByDirection.get(direction) || {
      id: id(),
      direction,
      label: fallbackOption(direction, questionIndex),
      value: fallbackOption(direction, questionIndex)
    });

    return {
      id: question.id || id(),
      title: cleanText(question.title, `Question ${questionIndex + 1}`),
      question: cleanText(question.question, 'Add your question here.'),
      insight: cleanText(question.insight, ''),
      options
    };
  });

  return {
    title,
    description,
    questions: questions.length ? questions : exampleSurvey().questions,
    updatedAt: now
  };
}

function exampleSurvey() {
  return normalizeSurveyRaw({
    title: 'Emergency Medical Info Survey',
    description: 'A quick swipe survey to understand how people manage medical information in emergencies.',
    questions: [
      {
        title: 'Emergency Experience',
        question: 'Have you ever struggled accessing medical information during an emergency?',
        options: [
          { direction: 'left', label: 'Never experienced' },
          { direction: 'right', label: 'Yes, experienced once or more' },
          { direction: 'up', label: 'Yes, and it was stressful/serious' },
          { direction: 'down', label: 'Not sure / doesn’t apply' }
        ]
      },
      {
        title: 'Hospital Confusion',
        question: 'Have hospitals ever repeated tests or asked for missing medical history?',
        options: [
          { direction: 'left', label: 'No' },
          { direction: 'right', label: 'Yes' },
          { direction: 'up', label: 'Yes, multiple times / frustrating experience' },
          { direction: 'down', label: 'Not applicable' }
        ]
      },
      {
        title: 'Frequency of Hospital Use',
        question: 'How often do you or family visit hospitals?',
        options: [
          { direction: 'left', label: 'Rarely' },
          { direction: 'right', label: 'Sometimes' },
          { direction: 'up', label: 'Frequently' },
          { direction: 'down', label: 'Not applicable' }
        ]
      },
      {
        title: 'Emotional Stress',
        question: 'Managing medical paperwork during health situations feels stressful.',
        options: [
          { direction: 'left', label: 'Disagree' },
          { direction: 'right', label: 'Agree' },
          { direction: 'up', label: 'Strongly agree' },
          { direction: 'down', label: 'Not relevant to me' }
        ]
      },
      {
        title: 'Severity Perception',
        question: 'Missing medical information in emergencies is a serious issue.',
        options: [
          { direction: 'left', label: 'Disagree' },
          { direction: 'right', label: 'Agree' },
          { direction: 'up', label: 'Strongly agree' },
          { direction: 'down', label: 'Not sure' }
        ]
      },
      {
        title: 'Current Storage Method',
        question: 'How do you store medical information?',
        options: [
          { direction: 'left', label: 'Paper documents' },
          { direction: 'right', label: 'Phone notes/photos' },
          { direction: 'up', label: 'I don’t have a proper system' },
          { direction: 'down', label: 'Other method' }
        ]
      },
      {
        title: 'Trust in Digital Medical Info',
        question: 'Would you trust a secure digital system for emergency medical data?',
        options: [
          { direction: 'left', label: 'No' },
          { direction: 'right', label: 'Yes' },
          { direction: 'up', label: 'Yes, completely trust it' },
          { direction: 'down', label: 'Unsure' }
        ]
      },
      {
        title: 'Solution Relevance',
        question: 'Instant access to medical info in emergencies would be useful.',
        options: [
          { direction: 'left', label: 'Not useful' },
          { direction: 'right', label: 'Useful' },
          { direction: 'up', label: 'Extremely useful / essential' },
          { direction: 'down', label: 'Not needed for me' }
        ]
      },
      {
        title: 'Product Acceptance',
        question: 'Would you use an NFC-based medical ID bracelet or card?',
        options: [
          { direction: 'left', label: 'No' },
          { direction: 'right', label: 'Yes' },
          { direction: 'up', label: 'Yes, definitely would use' },
          { direction: 'down', label: 'Prefer other solutions' }
        ]
      },
      {
        title: 'Urgency Signal',
        question: 'This is a problem that should be solved urgently.',
        options: [
          { direction: 'left', label: 'Disagree' },
          { direction: 'right', label: 'Agree' },
          { direction: 'up', label: 'Strongly agree / urgent' },
          { direction: 'down', label: 'Not a priority for me' }
        ]
      }
    ]
  });
}

function normalizeSurveyRaw(raw) {
  const questions = raw.questions.map((question, questionIndex) => ({
    id: id(),
    title: question.title || `Question ${questionIndex + 1}`,
    question: question.question,
    insight: question.insight || '',
    options: DIRECTIONS.map((direction) => {
      const option = question.options.find((item) => item.direction === direction);
      return {
        id: id(),
        direction,
        label: option?.label || fallbackOption(direction, questionIndex),
        value: option?.label || fallbackOption(direction, questionIndex)
      };
    })
  }));

  return {
    title: raw.title,
    description: raw.description,
    questions
  };
}

function localSurveyFromPrompt(prompt) {
  const topic = cleanText(prompt, 'Customer feedback').replace(/^build\s+/i, '').slice(0, 90);
  const title = topic.length > 12 ? `${topic} Survey` : 'Swipe Feedback Survey';
  const base = [
    ['Need Awareness', `How relevant is ${topic.toLowerCase()} to you right now?`, ['Not relevant', 'Relevant', 'Very relevant', 'Not sure']],
    ['Current Behaviour', `How often do you deal with this problem or situation?`, ['Rarely', 'Sometimes', 'Frequently', 'Not applicable']],
    ['Pain Level', 'How frustrating does this feel when it happens?', ['Not frustrating', 'Frustrating', 'Very frustrating', 'Not sure']],
    ['Current Solution', 'Do you already have a good way to solve this?', ['No system', 'Some workaround', 'A strong system', 'Other']],
    ['Trust Signal', 'Would you trust a simple digital solution for this?', ['No', 'Yes', 'Yes, completely', 'Unsure']],
    ['Usefulness', 'A faster and easier solution would be useful to me.', ['Disagree', 'Agree', 'Strongly agree', 'Not relevant']],
    ['Willingness', 'Would you try a product that solves this clearly?', ['No', 'Yes', 'Definitely', 'Maybe later']],
    ['Urgency', 'This feels like a problem worth solving soon.', ['Disagree', 'Agree', 'Strongly agree', 'Not a priority']]
  ];

  return normalizeSurveyRaw({
    title,
    description: `A quick swipe survey about ${topic.toLowerCase()}.`,
    questions: base.map(([questionTitle, question, labels]) => ({
      title: questionTitle,
      question,
      options: [
        { direction: 'left', label: labels[0] },
        { direction: 'right', label: labels[1] },
        { direction: 'up', label: labels[2] },
        { direction: 'down', label: labels[3] }
      ]
    }))
  });
}

function surveyJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'questions'],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      questions: {
        type: 'array',
        minItems: 6,
        maxItems: 16,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'question', 'insight', 'options'],
          properties: {
            title: { type: 'string' },
            question: { type: 'string' },
            insight: { type: 'string' },
            options: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['direction', 'label', 'value'],
                properties: {
                  direction: { type: 'string', enum: DIRECTIONS },
                  label: { type: 'string' },
                  value: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  };
}

async function generateWithOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) return localSurveyFromPrompt(prompt);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      instructions: [
        'You create fun, research-useful swipe surveys.',
        'Each question must have exactly four answers mapped to directions: left, right, up, down.',
        'Use left for negative/low/no, right for positive/yes, up for stronger/high-intent/urgent, down for unsure/not applicable/other.',
        'Write in simple consumer-friendly language.',
        'Avoid collecting sensitive personal medical details, IDs, addresses, or unnecessary private information.',
        'Return valid JSON only.'
      ].join('\n'),
      input: `Create a swipe survey from this request:\n\n${prompt}`,
      text: {
        format: {
          type: 'json_schema',
          name: 'swipe_survey',
          strict: true,
          schema: surveyJsonSchema()
        }
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const data = await response.json();
  const text = data.output_text || data.output?.flatMap((item) => item.content || []).find((part) => part.type === 'output_text')?.text;
  if (!text) throw new Error('OpenAI returned no text');
  return JSON.parse(text);
}

function calculateStats(survey, responses) {
  const surveyResponses = responses.filter((response) => response.surveyId === survey.id);
  const completed = surveyResponses.filter((response) => response.completedAt);
  const questionStats = survey.questions.map((question) => {
    const optionStats = question.options.map((option) => {
      const count = surveyResponses.reduce((total, response) => {
        const found = response.answers.find((answer) => answer.questionId === question.id && answer.direction === option.direction);
        return total + (found ? 1 : 0);
      }, 0);
      return {
        ...option,
        count,
        percent: surveyResponses.length ? Math.round((count / surveyResponses.length) * 100) : 0
      };
    });

    return {
      id: question.id,
      title: question.title,
      question: question.question,
      totalAnswers: optionStats.reduce((sum, option) => sum + option.count, 0),
      options: optionStats
    };
  });

  const directionCounts = DIRECTIONS.map((direction) => ({
    direction,
    label: DIRECTION_LABELS[direction],
    count: surveyResponses.reduce((total, response) => total + response.answers.filter((answer) => answer.direction === direction).length, 0)
  }));

  const totalTime = completed.reduce((sum, response) => sum + (response.totalTimeMs || 0), 0);

  return {
    surveyId: survey.id,
    title: survey.title,
    totalResponses: surveyResponses.length,
    completedResponses: completed.length,
    questions: questionStats,
    directionCounts,
    averageTimeSeconds: completed.length ? Math.round(totalTime / completed.length / 1000) : 0,
    latestResponseAt: surveyResponses.at(-1)?.createdAt || null
  };
}

function assertOwner(req, survey) {
  return survey && survey.ownerId === req.user.id;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'SwipeSurvey AI', time: new Date().toISOString() });
});

app.post('/api/auth/signup', (req, res) => {
  const name = cleanText(req.body.name, 'Survey Creator');
  const email = cleanText(req.body.email).toLowerCase();
  const password = String(req.body.password || '');

  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Enter a valid email.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const db = readDb();
  if (db.users.some((user) => user.email === email)) return res.status(409).json({ error: 'That email is already registered.' });

  const user = {
    id: id(),
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeDb(db);

  res.status(201).json({ user: publicUser(user), token: createToken(user.id) });
});

app.post('/api/auth/login', (req, res) => {
  const email = cleanText(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const db = readDb();
  const user = db.users.find((item) => item.email === email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password.' });
  res.json({ user: publicUser(user), token: createToken(user.id) });
});

app.post('/api/auth/firebase', async (req, res, next) => {
  try {
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase Admin is not configured on the server.' });
    const idToken = String(req.body.idToken || '');
    if (!idToken) return res.status(400).json({ error: 'Missing Firebase ID token.' });
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const user = upsertFirebaseUser(decodedToken);
    res.json({ user: publicUser(user), token: createToken(user.id) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/surveys/example', requireAuth, (_req, res) => {
  res.json({ survey: exampleSurvey() });
});

app.post('/api/ai/survey', requireAuth, async (req, res, next) => {
  try {
    const prompt = cleanText(req.body.prompt);
    if (!prompt) return res.status(400).json({ error: 'Tell the AI what kind of survey to build.' });
    const draft = await generateWithOpenAI(prompt);
    res.json({ survey: normalizeSurvey(draft) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/surveys', requireAuth, (req, res) => {
  const db = readDb();
  const surveys = db.surveys
    .filter((survey) => survey.ownerId === req.user.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((survey) => ({
      ...survey,
      responseCount: db.responses.filter((response) => response.surveyId === survey.id).length
    }));
  res.json({ surveys });
});

app.post('/api/surveys', requireAuth, (req, res) => {
  const normalized = normalizeSurvey(req.body.survey || req.body);
  const db = readDb();
  const now = new Date().toISOString();
  const survey = {
    id: id(),
    ownerId: req.user.id,
    slug: slugify(normalized.title),
    title: normalized.title,
    description: normalized.description,
    questions: normalized.questions,
    isPublished: true,
    createdAt: now,
    updatedAt: now
  };
  db.surveys.push(survey);
  writeDb(db);
  res.status(201).json({ survey });
});

app.get('/api/surveys/:id', requireAuth, (req, res) => {
  const db = readDb();
  const survey = db.surveys.find((item) => item.id === req.params.id);
  if (!assertOwner(req, survey)) return res.status(404).json({ error: 'Survey not found.' });
  res.json({ survey });
});

app.patch('/api/surveys/:id', requireAuth, (req, res) => {
  const db = readDb();
  const survey = db.surveys.find((item) => item.id === req.params.id);
  if (!assertOwner(req, survey)) return res.status(404).json({ error: 'Survey not found.' });

  const normalized = normalizeSurvey(req.body.survey || req.body);
  survey.title = normalized.title;
  survey.description = normalized.description;
  survey.questions = normalized.questions;
  survey.isPublished = req.body.isPublished ?? survey.isPublished;
  survey.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ survey });
});

app.delete('/api/surveys/:id', requireAuth, (req, res) => {
  const db = readDb();
  const survey = db.surveys.find((item) => item.id === req.params.id);
  if (!assertOwner(req, survey)) return res.status(404).json({ error: 'Survey not found.' });
  db.surveys = db.surveys.filter((item) => item.id !== survey.id);
  db.responses = db.responses.filter((item) => item.surveyId !== survey.id);
  writeDb(db);
  res.json({ ok: true });
});

app.get('/api/surveys/:id/stats', requireAuth, (req, res) => {
  const db = readDb();
  const survey = db.surveys.find((item) => item.id === req.params.id);
  if (!assertOwner(req, survey)) return res.status(404).json({ error: 'Survey not found.' });
  res.json({ stats: calculateStats(survey, db.responses) });
});

app.get('/api/surveys/:id/export.csv', requireAuth, (req, res) => {
  const db = readDb();
  const survey = db.surveys.find((item) => item.id === req.params.id);
  if (!assertOwner(req, survey)) return res.status(404).send('Survey not found.');

  const rows = [['response_id', 'submitted_at', 'question', 'direction', 'answer_label', 'answer_time_ms']];
  db.responses
    .filter((response) => response.surveyId === survey.id)
    .forEach((response) => {
      response.answers.forEach((answer) => {
        const question = survey.questions.find((item) => item.id === answer.questionId);
        rows.push([
          response.id,
          response.createdAt,
          question?.question || answer.questionId,
          answer.direction,
          answer.optionLabel,
          answer.timeMs || 0
        ]);
      });
    });

  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${survey.slug}-responses.csv"`);
  res.send(csv);
});

app.get('/api/s/:slug', (req, res) => {
  const db = readDb();
  const survey = db.surveys.find((item) => item.slug === req.params.slug && item.isPublished);
  if (!survey) return res.status(404).json({ error: 'Survey not found.' });
  res.json({
    survey: {
      id: survey.id,
      slug: survey.slug,
      title: survey.title,
      description: survey.description,
      questions: survey.questions,
      createdAt: survey.createdAt
    }
  });
});

app.post('/api/s/:slug/responses', (req, res) => {
  const db = readDb();
  const survey = db.surveys.find((item) => item.slug === req.params.slug && item.isPublished);
  if (!survey) return res.status(404).json({ error: 'Survey not found.' });

  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  if (!answers.length) return res.status(400).json({ error: 'No answers submitted.' });

  const validAnswers = answers.map((answer) => {
    const question = survey.questions.find((item) => item.id === answer.questionId);
    const option = question?.options.find((item) => item.direction === answer.direction || item.id === answer.optionId);
    if (!question || !option) return null;
    return {
      questionId: question.id,
      direction: option.direction,
      optionId: option.id,
      optionLabel: option.label,
      timeMs: Number(answer.timeMs || 0)
    };
  }).filter(Boolean);

  if (!validAnswers.length) return res.status(400).json({ error: 'No valid answers submitted.' });

  const response = {
    id: id(),
    surveyId: survey.id,
    answers: validAnswers,
    totalTimeMs: Number(req.body.totalTimeMs || validAnswers.reduce((sum, answer) => sum + answer.timeMs, 0)),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  };

  db.responses.push(response);
  writeDb(db);
  res.status(201).json({ ok: true, responseId: response.id });
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found.' });
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Something went wrong.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SwipeSurvey AI API running on http://localhost:${PORT}`);
});
