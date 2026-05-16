import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_URL || (window.location.port === '5173' ? 'http://localhost:8787' : '');
const DIRECTIONS = ['left', 'right', 'up', 'down'];
const ARROWS = { left: '⬅️', right: '➡️', up: '⬆️', down: '⬇️' };
const DIRECTION_WORDS = { left: 'Swipe left', right: 'Swipe right', up: 'Swipe up', down: 'Swipe down' };

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

function Shell({ children, user, logout, compact = false }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" onClick={() => (window.location.href = '/')}>
          <span className="brand-mark">↕</span>
          <span>SwipeSurvey AI</span>
        </div>
        {!compact && (
          <div className="topbar-actions">
            {user && <span className="muted hide-mobile">{user.email}</span>}
            {logout && <button className="ghost-btn" onClick={logout}>Log out</button>}
          </div>
        )}
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

  return (
    <Shell compact>
      <main className="auth-grid">
        <section className="hero-card">
          <div className="pill">Surveys people actually finish</div>
          <h1>Turn boring questions into swipeable little moments.</h1>
          <p>
            Build a survey manually or let AI create it from a prompt. Share a link. Let people answer by swiping left, right, up, or down.
          </p>
          <div className="direction-demo">
            <span>⬅️ No</span><span>➡️ Yes</span><span>⬆️ Strong yes</span><span>⬇️ Unsure</span>
          </div>
        </section>

        <form className="auth-card" onSubmit={submit}>
          <h2>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
          <p className="muted">Your dashboard stores surveys and results locally through the Node server.</p>
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
          <button className="primary-btn" disabled={busy}>{busy ? 'One sec…' : mode === 'signup' ? 'Sign up' : 'Log in'}</button>
          <button type="button" className="link-btn" onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>
            {mode === 'signup' ? 'Already have an account? Log in' : 'Need an account? Sign up'}
          </button>
        </form>
      </main>
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
            <div className="pill free-pill">Free to start</div>
            <h1>Turn boring questions into swipeable little moments.</h1>
            <p>Build a survey with AI, share one link, and make answering feel fast on every phone.</p>
            <div className="hero-actions">
              <button className="primary-btn large" onClick={() => navigate('/builder')}>+ New survey</button>
              <span className="free-note">No payment required.</span>
            </div>
          </div>
          <AnimatedSurveyDemo />
        </section>

        {message && <div className="toast">{message}</div>}
        {loading ? <FullPageLoader label="Fetching surveys…" /> : null}

        {!loading && surveys.length === 0 && (
          <section className="empty-state">
            <h2>No surveys yet</h2>
            <p>Start with AI, paste your own question set, or use the sample medical emergency survey.</p>
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

function AnimatedSurveyDemo() {
  const demoAnswers = [
    { direction: 'right', label: 'Useful' },
    { direction: 'up', label: 'Very interested' },
    { direction: 'left', label: 'Not today' }
  ];

  return (
    <div className="survey-demo" aria-label="Sample survey animation">
      <div className="demo-phone">
        <div className="demo-top">
          <span>PulseCheck</span>
          <strong>3 questions</strong>
        </div>
        <div className="demo-card">
          <span className="mini-badge">Product feedback</span>
          <h2>Would this help your team make faster decisions?</h2>
        </div>
        <div className="demo-answer-stack">
          {demoAnswers.map((answer, index) => (
            <div className={`demo-answer ${answer.direction}`} style={{ animationDelay: `${index * 1.2}s` }} key={answer.label}>
              <span>{ARROWS[answer.direction]}</span>
              <strong>{answer.label}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="demo-result">
        <span>Live result</span>
        <strong>87%</strong>
        <small>would share feedback again</small>
      </div>
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
        <div className="brand"><span className="brand-mark">↕</span><span>SwipeSurvey AI</span></div>
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

  return (
    <section className="swipe-stage">
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
        {dominantDirection && <div className="swipe-signal">{ARROWS[dominantDirection]} {question.options.find((item) => item.direction === dominantDirection)?.label}</div>}
      </article>

      <div className="answer-grid" aria-label="Answer choices">
        {DIRECTIONS.map((direction) => (
          <button className={`answer-choice ${direction}`} key={direction} onClick={() => onAnswer(direction)}>
            <span>{ARROWS[direction]}</span>
            <strong>{question.options.find((item) => item.direction === direction)?.label}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
