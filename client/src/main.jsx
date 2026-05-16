import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithRedirect } from 'firebase/auth';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_URL || (window.location.port === '5173' ? 'http://localhost:8787' : '');
const DIRECTIONS = ['left', 'right', 'up', 'down'];
const ARROWS = { left: '⬅️', right: '➡️', up: '⬆️', down: '⬇️' };
const DIRECTION_WORDS = { left: 'Swipe left', right: 'Swipe right', up: 'Swipe up', down: 'Swipe down' };
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};
const firebaseApp = initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function getToken() {
  return localStorage.getItem('swipeSurveyToken');
}

function setToken(token) {
  if (token) localStorage.setItem('swipeSurveyToken', token);
  else localStorage.removeItem('swipeSurveyToken');
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || data || 'Request failed');
  return data;
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (nextPath) => {
    window.history.pushState({}, '', nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return { path, navigate };
}

function App() {
  const { path, navigate } = useRoute();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  if (path.startsWith('/s/')) return <SurveyTaker slug={decodeURIComponent(path.split('/s/')[1] || '')} />;
  if (checking) return <FullPageLoader label="Loading your surveys…" />;
  if (!user) return <AuthView onAuthed={(data) => { setToken(data.token); setUser(data.user); navigate('/'); }} />;

  const logout = () => {
    setToken(null);
    setUser(null);
    navigate('/');
  };

  if (path.startsWith('/builder')) return <Builder navigate={navigate} user={user} logout={logout} />;
  if (path.startsWith('/stats/')) return <StatsView surveyId={path.split('/stats/')[1]} navigate={navigate} logout={logout} />;
  return <Dashboard navigate={navigate} user={user} logout={logout} />;
}

function MobileBuildButton() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 940);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (!isMobile) return null;
  return (
    <a className="primary-btn build-btn" href="/?signup=1">Build a survey</a>
  );
}

function Shell({ children, user, logout, compact = false }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" onClick={() => (window.location.href = '/')}>
          <span className="brand-mark">S</span>
          <span>SwipeSurvey™ <small>AI powered</small></span>
        </div>
        <div className="topbar-actions">
          {user && <span className="muted hide-mobile">{user.email}</span>}
          <MobileBuildButton />
          {logout && <button className="ghost-btn" onClick={logout}>Log out</button>}
        </div>
      </header>
      {children}
    </div>
  );
}

function FullPageLoader({ label }) {
  return (
    <div className="loader-screen">
      <div className="pulse-orb">↕</div>
      <p>{label}</p>
    </div>
  );
}

function AuthView({ onAuthed }) {
  const [mode, setMode] = useState('signup');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const completingGoogleAuth = useRef(false);

  useEffect(() => {
    const completeGoogleAuth = async (firebaseUser) => {
      if (!firebaseUser || completingGoogleAuth.current || getToken()) return;
      completingGoogleAuth.current = true;
      setBusy(true);
      const idToken = await firebaseUser.getIdToken();
      const data = await api('/api/auth/firebase', { method: 'POST', body: { idToken } });
      sessionStorage.removeItem('swipeSurveyGooglePending');
      onAuthed(data);
    };

    const unsubscribe = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
      completeGoogleAuth(firebaseUser).catch((err) => {
        completingGoogleAuth.current = false;
        setError(err.message);
        setBusy(false);
      });
    });

    getRedirectResult(firebaseAuth)
      .then((credential) => completeGoogleAuth(credential?.user || firebaseAuth.currentUser))
      .catch((err) => {
        completingGoogleAuth.current = false;
        sessionStorage.removeItem('swipeSurveyGooglePending');
        setError(err.message);
        setBusy(false);
      });

    const hadPendingGoogleAuth = sessionStorage.getItem('swipeSurveyGooglePending');
    if (hadPendingGoogleAuth) {
      setBusy(true);
      setTimeout(() => {
        if (!getToken() && !completingGoogleAuth.current) {
          completeGoogleAuth(firebaseAuth.currentUser).catch((err) => {
            completingGoogleAuth.current = false;
            sessionStorage.removeItem('swipeSurveyGooglePending');
            setError(err.message || 'Google sign-in returned without a user. Please try again.');
            setBusy(false);
          });
        }
      }, 700);
    }

    return unsubscribe;
  }, [onAuthed]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body: form });
      onAuthed(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      await setPersistence(firebaseAuth, browserLocalPersistence);
      sessionStorage.setItem('swipeSurveyGooglePending', '1');
      await signInWithRedirect(firebaseAuth, googleProvider);
    } catch (err) {
      sessionStorage.removeItem('swipeSurveyGooglePending');
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Shell compact>
      <main className="auth-grid">
        <section className="hero-card">
          <div className="pill free-pill">Free to start</div>
          <h1><span>Swipeable</span> <span>surveys</span> <span>in minutes.</span></h1>
          <p className="hero-subhead">
            <span>Build with AI, share one link,</span> <span>and collect fast mobile responses.</span>
          </p>
          <HomeSurveyDemo />
        </section>

        <div className="auth-side">
          <form className="auth-card" onSubmit={submit}>
            <h2>{mode === 'signup' ? 'Create a survey' : 'Welcome back'}</h2>
            <p className="muted">Save and revisit your surveys anytime.</p>
            {mode === 'signup' && (
              <label>
                Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Abdullah" />
              </label>
            )}
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@email.com" required />
            </label>
            <label>
              Password
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" required />
            </label>
            {error && <div className="error-box">{error}</div>}
            <button type="button" className="google-btn" onClick={signInWithGoogle} disabled={busy}>
              <span>G</span>
              Continue with Google
            </button>
            <button className="primary-btn" disabled={busy}>{busy ? 'One sec…' : mode === 'signup' ? 'Sign up' : 'Log in'}</button>
            <button type="button" className="link-btn" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
              {mode === 'signup' ? 'Already have an account? Log in' : 'Need an account? Sign up'}
            </button>
          </form>

          <section className="benefits-card">
            <div className="benefits-header">
              <span className="mini-badge hot">Built for quick signal</span>
              <h3>Research without the form fatigue.</h3>
              <p>Prompt, publish, and read directional intent without forcing people through a long questionnaire.</p>
            </div>
            <div className="benefit-tiles">
              <div><strong>AI draft</strong><span>Go from idea to editable survey in seconds.</span></div>
              <div><strong>Swipe UX</strong><span>Answers feel fast enough for mobile attention spans.</span></div>
              <div><strong>Share link</strong><span>Send one link and watch response patterns collect.</span></div>
            </div>
            <div className="signal-strip">
              <span>⬅ Friction</span>
              <span>➡ Interest</span>
              <span>⬆ Urgency</span>
            </div>
          </section>
        </div>
      </main>
      <footer className="site-footer">
        <span>SwipeSurvey™ - AI powered</span>
        <span>Built in Abu Dhabi</span>
        <span>© 2026 SwipeSurvey. All rights reserved.</span>
      </footer>
    </Shell>
  );
}

function Dashboard({ navigate, user, logout }) {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api('/api/surveys')
      .then((data) => setSurveys(data.surveys))
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, []);

  const copyLink = async (slug) => {
    const link = `${window.location.origin}/s/${slug}`;
    await navigator.clipboard.writeText(link);
    setMessage('Survey link copied.');
    setTimeout(() => setMessage(''), 2000);
  };

  const deleteSurvey = async (surveyId) => {
    if (!confirm('Delete this survey and all its responses?')) return;
    await api(`/api/surveys/${surveyId}`, { method: 'DELETE' });
    setSurveys((items) => items.filter((survey) => survey.id !== surveyId));
  };

  return (
    <Shell user={user} logout={logout}>
      <main className="dashboard">
        <section className="dashboard-hero">
          <div className="dashboard-copy">
            <div className="pill">Creator dashboard</div>
            <h1>Your surveys</h1>
            <p>Create a new survey, copy share links, preview live surveys, and check results from one place.</p>
          </div>
          <button className="primary-btn large" onClick={() => navigate('/builder')}>+ New survey</button>
        </section>

        {message && <div className="toast">{message}</div>}
        {loading ? <FullPageLoader label="Fetching surveys…" /> : null}

        {!loading && surveys.length === 0 && (
          <section className="empty-state">
            <h2>No surveys yet</h2>
            <p>Start with AI or use the sample medical emergency survey.</p>
            <button className="primary-btn" onClick={() => navigate('/builder')}>Build your first survey</button>
          </section>
        )}

        <section className="survey-grid">
          {surveys.map((survey) => (
            <article className="survey-card" key={survey.id}>
              <div className="survey-card-head">
                <span className="mini-badge">{survey.questions.length} questions</span>
                <span className="mini-badge hot">{survey.responseCount || 0} responses</span>
              </div>
              <h3>{survey.title}</h3>
              <p>{survey.description}</p>
              <div className="card-actions">
                <button onClick={() => navigate(`/stats/${survey.id}`)}>View stats</button>
                <button onClick={() => copyLink(survey.slug)}>Copy link</button>
                <button onClick={() => window.open(`/s/${survey.slug}`, '_blank')}>Preview</button>
                <button className="danger" onClick={() => deleteSurvey(survey.id)}>Delete</button>
              </div>
            </article>
          ))}
        </section>
      </main>
    </Shell>
  );
}

function HomeSurveyDemo() {
  const demoQuestions = [
    {
      id: 'demo-1',
      title: 'Product feedback',
      question: 'Would this help your team make faster decisions?',
      options: [
        { direction: 'left', label: 'Not really' },
        { direction: 'right', label: 'Yes' },
        { direction: 'up', label: 'Absolutely' },
        { direction: 'down', label: 'Not sure' }
      ]
    },
    {
      id: 'demo-2',
      title: 'Buying intent',
      question: 'How likely would you be to try this next week?',
      options: [
        { direction: 'left', label: 'Unlikely' },
        { direction: 'right', label: 'Likely' },
        { direction: 'up', label: 'Very likely' },
        { direction: 'down', label: 'Need details' }
      ]
    },
    {
      id: 'demo-3',
      title: 'Sharing',
      question: 'Would you send this survey to a customer?',
      options: [
        { direction: 'left', label: 'No' },
        { direction: 'right', label: 'Yes' },
        { direction: 'up', label: 'Definitely' },
        { direction: 'down', label: 'Maybe' }
      ]
    },
    {
      id: 'demo-4',
      title: 'Urgency',
      question: 'How urgent is this problem for your team?',
      options: [
        { direction: 'left', label: 'Low' },
        { direction: 'right', label: 'Important' },
        { direction: 'up', label: 'Critical' },
        { direction: 'down', label: 'Unknown' }
      ]
    },
    {
      id: 'demo-5',
      title: 'Follow-up',
      question: 'Would you want a deeper interview after this?',
      options: [
        { direction: 'left', label: 'No' },
        { direction: 'right', label: 'Yes' },
        { direction: 'up', label: 'Book it' },
        { direction: 'down', label: 'Later' }
      ]
    }
  ];
  const [answers, setAnswers] = useState([]);
  const [exitingDirection, setExitingDirection] = useState(null);
  const current = demoQuestions[answers.length];
  const questionIndex = answers.length;
  const done = answers.length === demoQuestions.length;
  const positive = answers.filter((answer) => answer === 'right' || answer === 'up').length;
  const score = Math.round((positive / demoQuestions.length) * 100);

  return (
    <div className="survey-demo" aria-label="Try a sample swipe survey">
      <div className="demo-phone-frame">
        <div className="demo-speaker" />
        <div className={`demo-shell theme-${done ? 'result' : questionIndex}`}>
          <div className="demo-top">
            <span>Try the demo</span>
            <strong className="demo-progress">{done ? 'Result' : `${answers.length + 1} / ${demoQuestions.length}`}</strong>
          </div>
          {!done ? (
            <>
              <DemoCompassCard
                key={current.id}
                question={current}
                exitingDirection={exitingDirection}
                onAnswer={(direction) => {
                  if (exitingDirection) return;
                  setExitingDirection(direction);
                  setTimeout(() => {
                    setAnswers((items) => [...items, direction]);
                    setExitingDirection(null);
                  }, 420);
                }}
              />
              <p className="demo-hint">Swipe the black card toward an answer.</p>
            </>
          ) : (
            <div className="demo-final">
              <span className="mini-badge">Demo result</span>
              <strong>{score}%</strong>
              <p>{positive} of {demoQuestions.length} answers showed positive intent.</p>
              <button className="primary-btn" onClick={() => setAnswers([])}>Try again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DemoCompassCard({ question, onAnswer, exitingDirection }) {
  const [drag, setDrag] = useState({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
  const cardRef = useRef(null);
  const optionLabel = (direction) => question.options.find((item) => item.direction === direction)?.label;
  const dominantDirection = useMemo(() => {
    const { x, y } = drag;
    if (Math.abs(x) < 24 && Math.abs(y) < 24) return null;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
  }, [drag]);
  const pointerDown = (event) => {
    cardRef.current?.setPointerCapture?.(event.pointerId);
    setDrag({ active: true, startX: event.clientX, startY: event.clientY, x: 0, y: 0 });
  };
  const pointerMove = (event) => {
    if (!drag.active) return;
    setDrag((current) => ({ ...current, x: event.clientX - current.startX, y: event.clientY - current.startY }));
  };
  const pointerUp = () => {
    const distance = Math.max(Math.abs(drag.x), Math.abs(drag.y));
    const direction = dominantDirection;
    setDrag({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
    if (distance > 54 && direction) onAnswer(direction);
  };
  const transform = `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 18}deg)`;

  return (
    <div className="demo-compass">
      <div className={`answer-choice compact up ${dominantDirection === 'up' ? 'active' : ''}`}><span>{ARROWS.up}</span><strong>{optionLabel('up')}</strong></div>
      <div className="demo-compass-row">
        <div className={`answer-choice compact left ${dominantDirection === 'left' ? 'active' : ''}`}><span>{ARROWS.left}</span><strong>{optionLabel('left')}</strong></div>
        <div
          ref={cardRef}
          className={`demo-question-card ${dominantDirection ? `lean-${dominantDirection}` : ''} ${exitingDirection ? `exit-${exitingDirection}` : ''}`}
          style={{ transform }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        >
          <span className="mini-badge">{question.title}</span>
          <h2>{question.question}</h2>
        </div>
        <div className={`answer-choice compact right ${dominantDirection === 'right' ? 'active' : ''}`}><span>{ARROWS.right}</span><strong>{optionLabel('right')}</strong></div>
      </div>
      <div className={`answer-choice compact down ${dominantDirection === 'down' ? 'active' : ''}`}><span>{ARROWS.down}</span><strong>{optionLabel('down')}</strong></div>
    </div>
  );
}

function blankQuestion(index) {
  return {
    id: makeId(),
    title: `Question ${index}`,
    question: 'Type your question here.',
    insight: '',
    options: DIRECTIONS.map((direction) => ({
      id: makeId(),
      direction,
      label: direction === 'left' ? 'No' : direction === 'right' ? 'Yes' : direction === 'up' ? 'Strongly yes' : 'Not sure',
      value: direction
    }))
  };
}

function Builder({ navigate, user, logout }) {
  const [prompt, setPrompt] = useState('Build a 10-question survey for an NFC medical ID startup. Focus on emergency experiences, hospital confusion, stress, trust, usefulness, product acceptance, and urgency.');
  const [survey, setSurvey] = useState(null);
  const [savedSurvey, setSavedSurvey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/ai/survey', { method: 'POST', body: { prompt } });
      setSurvey(data.survey);
      setSavedSurvey(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const loadExample = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/surveys/example');
      setSurvey(data.survey);
      setSavedSurvey(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveSurvey = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/surveys', { method: 'POST', body: { survey } });
      setSavedSurvey(data.survey);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const updateQuestion = (questionIndex, patch) => {
    setSurvey((current) => ({
      ...current,
      questions: current.questions.map((question, index) => index === questionIndex ? { ...question, ...patch } : question)
    }));
  };

  const updateOption = (questionIndex, direction, label) => {
    setSurvey((current) => ({
      ...current,
      questions: current.questions.map((question, index) => index === questionIndex ? {
        ...question,
        options: question.options.map((option) => option.direction === direction ? { ...option, label, value: label } : option)
      } : question)
    }));
  };

  const shareLink = savedSurvey ? `${window.location.origin}/s/${savedSurvey.slug}` : '';

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(shareLink);
  };

  return (
    <Shell user={user} logout={logout}>
      <main className="builder-flow">
        <section className="builder-panel creator-start">
          <button className="back-btn" onClick={() => navigate('/')}>← Dashboard</button>
          <div className="pill">New survey</div>
          <h1>Create a swipe survey.</h1>
          <p>Describe the survey you want. AI will draft the questions and answers, then you can review before sharing.</p>

          <label>
            What should this survey ask about?
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} />
          </label>
          <div className="split-actions">
            <button className="primary-btn" onClick={generate} disabled={busy}>{busy ? 'Building…' : 'Generate with AI'}</button>
            <button onClick={loadExample} disabled={busy}>Use sample</button>
          </div>
          {error && <div className="error-box">{error}</div>}
        </section>

        {savedSurvey && (
          <section className="share-panel">
            <div>
              <div className="pill">Ready to share</div>
              <h2>Your survey link is live.</h2>
              <p>Send this link to respondents.</p>
            </div>
            <div className="share-link-box">
              <input value={shareLink} readOnly onFocus={(event) => event.target.select()} />
              <button className="primary-btn" onClick={copyShareLink}>Copy link</button>
            </div>
            <div className="share-actions">
              <button onClick={() => window.open(`/s/${savedSurvey.slug}`, '_blank')}>Open survey</button>
              <button onClick={() => navigate(`/stats/${savedSurvey.id}`)}>View results</button>
              <button onClick={() => navigate('/')}>Dashboard</button>
            </div>
          </section>
        )}

        {!survey && !savedSurvey && (
          <section className="builder-empty">
            <h2>Your draft will appear below.</h2>
            <p>Use one clear prompt, then review the generated wording before publishing.</p>
          </section>
        )}

        {survey && (
          <section className="editor-panel">
            <div className="survey-editor">
              <div className="editor-header">
                <div>
                  <div className="pill">Review draft</div>
                  <input className="title-input" value={survey.title} onChange={(e) => setSurvey({ ...survey, title: e.target.value })} />
                  <textarea className="description-input" value={survey.description} onChange={(e) => setSurvey({ ...survey, description: e.target.value })} rows={2} />
                </div>
                <button className="primary-btn" onClick={saveSurvey} disabled={busy}>{busy ? 'Publishing…' : 'Publish & get link'}</button>
              </div>

              {survey.questions.map((question, questionIndex) => (
                <article className="question-editor" key={question.id}>
                  <div className="question-editor-top">
                    <span className="mini-badge">Card {questionIndex + 1}</span>
                    <button className="danger small" onClick={() => setSurvey({ ...survey, questions: survey.questions.filter((_, index) => index !== questionIndex) })}>Remove</button>
                  </div>
                  <input value={question.title} onChange={(e) => updateQuestion(questionIndex, { title: e.target.value })} />
                  <textarea value={question.question} onChange={(e) => updateQuestion(questionIndex, { question: e.target.value })} rows={2} />
                  <div className="option-editor-grid">
                    {question.options.map((option) => (
                      <label key={option.direction} className={`option-edit ${option.direction}`}>
                        {ARROWS[option.direction]} {DIRECTION_WORDS[option.direction]}
                        <input value={option.label} onChange={(e) => updateOption(questionIndex, option.direction, e.target.value)} />
                      </label>
                    ))}
                  </div>
                </article>
              ))}

              <button onClick={() => setSurvey({ ...survey, questions: [...survey.questions, blankQuestion(survey.questions.length + 1)] })}>+ Add question</button>
            </div>
          </section>
        )}
      </main>
    </Shell>
  );
}

function StatsView({ surveyId, navigate, logout }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/api/surveys/${surveyId}/stats`)
      .then((data) => setStats(data.stats))
      .catch((err) => setError(err.message));
  }, [surveyId]);

  const exportCsv = async () => {
    const token = getToken();
    const response = await fetch(`${API_BASE}/api/surveys/${surveyId}/export.csv`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${stats?.title || 'survey'}-responses.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Shell logout={logout}>
      <main className="stats-page">
        <button className="back-btn" onClick={() => navigate('/')}>← Dashboard</button>
        {error && <div className="error-box">{error}</div>}
        {!stats && !error && <FullPageLoader label="Crunching numbers…" />}
        {stats && (
          <>
            <section className="stats-hero">
              <div>
                <div className="pill">Live results</div>
                <h1>{stats.title}</h1>
                <p>{stats.completedResponses} completed responses · {stats.averageTimeSeconds}s average completion time</p>
              </div>
              <button className="primary-btn" onClick={exportCsv}>Export CSV</button>
            </section>

            <section className="metric-grid">
              <Metric label="Total responses" value={stats.totalResponses} />
              <Metric label="Completed" value={stats.completedResponses} />
              <Metric label="Avg. seconds" value={stats.averageTimeSeconds} />
              <Metric label="Questions" value={stats.questions.length} />
            </section>

            <section className="question-stats-list">
              {stats.questions.map((question, index) => (
                <article className="stats-card" key={question.id}>
                  <div className="mini-badge">Q{index + 1}</div>
                  <h3>{question.question}</h3>
                  {question.options.map((option) => (
                    <div className="bar-row" key={option.direction}>
                      <div className="bar-label"><span>{ARROWS[option.direction]}</span>{option.label}</div>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${option.percent}%` }} /></div>
                      <strong>{option.count}</strong>
                      <small>{option.percent}%</small>
                    </div>
                  ))}
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </Shell>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SurveyTaker({ slug }) {
  const [survey, setSurvey] = useState(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
  const surveyStartedAt = useRef(Date.now());

  useEffect(() => {
    api(`/api/s/${slug}`)
      .then((data) => {
        setSurvey(data.survey);
        setQuestionStartedAt(Date.now());
        surveyStartedAt.current = Date.now();
      })
      .catch((err) => setError(err.message));
  }, [slug]);

  const submit = async (nextAnswers) => {
    setSubmitting(true);
    try {
      await api(`/api/s/${slug}/responses`, {
        method: 'POST',
        body: { answers: nextAnswers, totalTimeMs: Date.now() - surveyStartedAt.current }
      });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const answer = (direction) => {
    if (!survey || done || submitting) return;
    const question = survey.questions[idx];
    const option = question.options.find((item) => item.direction === direction);
    if (!option) return;

    const nextAnswers = [...answers, {
      questionId: question.id,
      optionId: option.id,
      direction,
      optionLabel: option.label,
      timeMs: Date.now() - questionStartedAt
    }];

    setAnswers(nextAnswers);
    if (idx >= survey.questions.length - 1) submit(nextAnswers);
    else {
      setIdx(idx + 1);
      setQuestionStartedAt(Date.now());
    }
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'ArrowLeft') answer('left');
      if (event.key === 'ArrowRight') answer('right');
      if (event.key === 'ArrowUp') answer('up');
      if (event.key === 'ArrowDown') answer('down');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) return <PublicShell><div className="error-box big">{error}</div></PublicShell>;
  if (!survey) return <FullPageLoader label="Opening survey…" />;
  if (done) return (
    <PublicShell>
      <section className="thank-you-card">
        <div className="confetti">✨</div>
        <h1>Done. That was painless.</h1>
        <p>Thanks for answering {survey.title}. Your response has been saved.</p>
      </section>
    </PublicShell>
  );

  const question = survey.questions[idx];
  const progress = Math.round(((idx + 1) / survey.questions.length) * 100);

  return (
    <PublicShell>
      <main className="swipe-survey-page">
        <section className="survey-intro-mini">
          <div>
            <div className="pill">{idx + 1} / {survey.questions.length}</div>
            <h1>{survey.title}</h1>
            <p>{survey.description}</p>
          </div>
          <div className="progress-circle">{progress}%</div>
        </section>
        <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>
        <SwipeCard key={question.id} question={question} onAnswer={answer} />
        <p className="keyboard-hint">Tip: swipe the card, tap an answer, or use your keyboard arrows.</p>
      </main>
    </PublicShell>
  );
}

function PublicShell({ children }) {
  return (
    <div className="public-shell">
      <header className="public-topbar">
        <div className="brand"><span className="brand-mark">S</span><span>SwipeSurvey™ <small>AI powered</small></span></div>
        <MobileBuildButton />
      </header>
      {children}
    </div>
  );
}

function SwipeCard({ question, onAnswer }) {
  const [drag, setDrag] = useState({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
  const cardRef = useRef(null);

  const dominantDirection = useMemo(() => {
    const { x, y } = drag;
    if (Math.abs(x) < 30 && Math.abs(y) < 30) return null;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
  }, [drag]);

  const pointerDown = (event) => {
    cardRef.current?.setPointerCapture?.(event.pointerId);
    setDrag({ active: true, startX: event.clientX, startY: event.clientY, x: 0, y: 0 });
  };

  const pointerMove = (event) => {
    if (!drag.active) return;
    setDrag((current) => ({ ...current, x: event.clientX - current.startX, y: event.clientY - current.startY }));
  };

  const pointerUp = () => {
    const distance = Math.max(Math.abs(drag.x), Math.abs(drag.y));
    const direction = dominantDirection;
    setDrag({ active: false, startX: 0, startY: 0, x: 0, y: 0 });
    if (distance > 90 && direction) onAnswer(direction);
  };

  const transform = `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 18}deg)`;
  const optionLabel = (direction) => question.options.find((item) => item.direction === direction)?.label;

  return (
    <section className="swipe-stage">
      <div className={`answer-choice compass-choice up ${dominantDirection === 'up' ? 'active' : ''}`}><span>{ARROWS.up}</span><strong>{optionLabel('up')}</strong></div>
      <div className="swipe-center-row">
        <div className={`answer-choice compass-choice left ${dominantDirection === 'left' ? 'active' : ''}`}><span>{ARROWS.left}</span><strong>{optionLabel('left')}</strong></div>
        <article
          ref={cardRef}
          className={`swipe-card ${dominantDirection ? `lean-${dominantDirection}` : ''}`}
          style={{ transform }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        >
          <div className="mini-badge">{question.title}</div>
          <h2>{question.question}</h2>
          {dominantDirection && <div className="swipe-signal">{ARROWS[dominantDirection]} {optionLabel(dominantDirection)}</div>}
        </article>
        <div className={`answer-choice compass-choice right ${dominantDirection === 'right' ? 'active' : ''}`}><span>{ARROWS.right}</span><strong>{optionLabel('right')}</strong></div>
      </div>
      <div className={`answer-choice compass-choice down ${dominantDirection === 'down' ? 'active' : ''}`}><span>{ARROWS.down}</span><strong>{optionLabel('down')}</strong></div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
