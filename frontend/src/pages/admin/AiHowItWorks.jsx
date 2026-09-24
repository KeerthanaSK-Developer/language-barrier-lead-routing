import React, { useState } from 'react';
import {
  Sparkles,
  Video,
  Mic,
  Brain,
  Languages,
  RefreshCcw,
  Percent,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

const PIPELINE = [
  {
    icon: Video,
    title: '1. Classify recording',
    body: 'Fetch unlocks 5 min after start — transcription runs as soon as a recording URL exists. If nobody clicks Fetch, the server auto-retries at end+5m and end+10m. Each meeting keeps its own videos.',
  },
  {
    icon: Mic,
    title: '2. Multilingual transcription',
    body: 'Local Whisper auto-detects language per audio chunk — Hindi, Tamil, Telugu, Malayalam, English, mixed speech, and more. No language lock to English.',
  },
  {
    icon: Brain,
    title: '3. AI call insights',
    body: 'The model reads fluency + content (not preferred alone). It returns join %, call languages, barrier / engagement / interest flags, summary, and next actions.',
  },
  {
    icon: Languages,
    title: '4. Call language',
    body: 'Fluent in the BDA language → that language is Call language. Not fluent → preferred is stored as Call language so the next BD match is correct.',
  },
  {
    icon: RefreshCcw,
    title: '5. Reassign button',
    body: 'Admin Reassign unlocks when AI flags: language barrier (with preferred named), poor BDA engagement, or lead not interested — each with a clear reason.',
  },
  {
    icon: Percent,
    title: '6. Join %',
    body: 'Join probability reflects interest, objections, and the flags above. Barriers / poor engagement / not-interested cap join % lower so the table stays honest.',
  },
];

const DEMOS = [
  {
    id: 'fluent',
    title: 'Fluent in BDA language',
    tag: 'No reassign',
    tagClass: 'badge-success',
    lead: {
      name: 'Priya Nair',
      preferred: 'Hindi',
      bda_language: 'English',
    },
    transcript: [
      'BDA: Hi Priya, thanks for joining. Shall we go over the data analytics course?',
      'Priya: Yes, English is fine for me. I already work with Python a bit.',
      'BDA: Great — the cohort starts next month. Any budget concerns?',
      'Priya: I can manage EMI. Can you share the syllabus PDF?',
    ],
    outcome: {
      callLanguages: ['English'],
      join_probability: 72,
      language_barrier: false,
      sales_cooperation: 'good',
      lead_not_interested: false,
      reassign: false,
      reason: '—',
      summary:
        'Lead is fluent and comfortable in English despite Hindi preferred. Strong interest; asked for syllabus. No language barrier.',
    },
  },
  {
    id: 'barrier',
    title: 'Not fluent — needs preferred language',
    tag: 'Reassign · language',
    tagClass: 'badge-warning',
    lead: {
      name: 'Rahul Sharma',
      preferred: 'Hindi',
      bda_language: 'English',
    },
    transcript: [
      'BDA: Hello Rahul, let’s discuss the course in English.',
      'Rahul: Sorry… English thoda problem. Mujhe samajh nahi aa raha.',
      'BDA: Can you try a little English?',
      'Rahul: Please Hindi mein baat kijiye. Main continue nahi kar sakta.',
    ],
    outcome: {
      callLanguages: ['Hindi'],
      join_probability: 18,
      language_barrier: true,
      sales_cooperation: 'good',
      lead_not_interested: false,
      reassign: true,
      reason:
        'Learner struggled in English and could not continue — lead prefers Hindi. Reassign to a Hindi-speaking BDA.',
      summary:
        'Real fluency barrier. Preferred Hindi is written as Call language for matching. Join % capped low until a language-fit BD connects.',
    },
  },
  {
    id: 'engagement',
    title: 'Lead engaged, BDA not engaging',
    tag: 'Reassign · engagement',
    tagClass: 'badge-danger',
    lead: {
      name: 'Meena Iyer',
      preferred: 'Tamil',
      bda_language: 'Tamil',
    },
    transcript: [
      'Meena: I’m ready — I have questions about career switch and EMI.',
      'BDA: Yeah whatever. Look at the website. I have another call.',
      'Meena: Can you explain the mentor support?',
      'BDA: It’s there in the brochure. Ok bye.',
    ],
    outcome: {
      callLanguages: ['Tamil'],
      join_probability: 28,
      language_barrier: false,
      sales_cooperation: 'poor',
      lead_not_interested: false,
      reassign: true,
      reason:
        'Lead was willing to talk; BDA was dismissive and did not engage or answer questions.',
      summary:
        'Language fit is fine. Flag poor BDA engagement so admin can reassign. Join % reduced because the sales experience failed.',
    },
  },
  {
    id: 'not_interested',
    title: 'Lead not interested · BDA communicated well',
    tag: 'Reassign · not interested',
    tagClass: 'badge-info',
    lead: {
      name: 'Arjun Kumar',
      preferred: 'English',
      bda_language: 'English',
    },
    transcript: [
      'BDA: Happy to walk through options and answer anything on pricing.',
      'Arjun: Thanks — I’ve decided not to join any course this year. Budget is tight.',
      'BDA: Totally fair. I can send a one-pager if plans change later.',
      'Arjun: No need. Please don’t follow up.',
    ],
    outcome: {
      callLanguages: ['English'],
      join_probability: 8,
      language_barrier: false,
      sales_cooperation: 'good',
      lead_not_interested: true,
      reassign: true,
      reason:
        'Lead clearly not interested / declined despite good BDA communication.',
      summary:
        'Fluency and BDA quality are fine. Still surfaces Reassign with a not-interested reason and a very low join % for routing honesty.',
    },
  },
];

const Field = ({ label, children }) => (
  <div>
    <dt className="text-xs text-gray-500 mb-0.5">{label}</dt>
    <dd className="text-sm text-gray-900">{children}</dd>
  </div>
);

const AiHowItWorks = () => {
  const [activeId, setActiveId] = useState(DEMOS[0].id);
  const demo = DEMOS.find((d) => d.id === activeId) || DEMOS[0];
  const o = demo.outcome;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary-600 shrink-0" />
            How AI call insights work
          </h1>
          <p className="text-gray-500 mt-1 text-sm sm:text-base max-w-3xl">
            Demo walkthrough of transcription → insights → Call language, Reassign, and Join %.
            Outcomes depend on fluency and conversation content — preferred language alone does not set Call language before a call.
          </p>
        </div>
      </div>

      <section className="card">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Pipeline</h2>
        <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {PIPELINE.map((step) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="rounded-lg border border-gray-200 bg-gray-50 p-4"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900 mb-2">
                  <Icon className="w-4 h-4 text-primary-600 shrink-0" />
                  {step.title}
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Decision rules</h2>
        <p className="text-xs text-gray-500 mb-4">
          What the model is instructed to decide from the transcript (any language).
        </p>
        <ul className="space-y-3 text-sm text-gray-800">
          <li className="flex gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
            <span>
              <strong className="font-semibold">Fluent</strong> in the language the BDA speaks →
              add it as <em>Call language</em>; no language reassign.
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <span>
              <strong className="font-semibold">Not fluent</strong> / cannot continue → Reassign
              with reason naming preferred language; store preferred as Call language; lower Join %.
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <span>
              Lead wants to talk but <strong className="font-semibold">BDA does not engage</strong> →
              Reassign (engagement) + lower Join %.
            </span>
          </li>
          <li className="flex gap-2">
            <AlertTriangle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <span>
              Lead <strong className="font-semibold">not interested</strong> even if BDA communicates
              well → Reassign with that reason + low Join %.
            </span>
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Demo scenarios</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Sample transcript snippets and the outcome the system is designed to produce.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {DEMOS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setActiveId(d.id)}
              className={`text-left text-xs sm:text-sm px-3 py-2 rounded-lg border transition-all ${
                activeId === d.id
                  ? 'border-primary-500 bg-primary-50 text-primary-900'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="font-medium block">{d.title}</span>
              <span className={`badge ${d.tagClass} mt-1 inline-block`}>{d.tag}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Lead context</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Name">{demo.lead.name}</Field>
                <Field label="Preferred">
                  <span className="badge badge-info">{demo.lead.preferred}</span>
                </Field>
                <Field label="BDA spoke">
                  <span className="badge badge-gray">{demo.lead.bda_language}</span>
                </Field>
              </dl>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Sample transcript</h3>
              <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {demo.transcript.map((line) => (
                  <li
                    key={line}
                    className="text-xs sm:text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded-md px-3 py-2"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">AI outcome</h3>
              <span className={`badge ${demo.tagClass}`}>{demo.tag}</span>
            </div>
            <dl className="space-y-3">
              <Field label="Call language (after processing)">
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {o.callLanguages.map((lang) => (
                    <span key={lang} className="badge badge-warning">{lang}</span>
                  ))}
                </div>
              </Field>
              <Field label="Join %">
                <span className="badge badge-info">{o.join_probability}%</span>
              </Field>
              <Field label="Language barrier">
                {o.language_barrier ? (
                  <span className="badge badge-warning">true</span>
                ) : (
                  <span className="badge badge-success">false</span>
                )}
              </Field>
              <Field label="BDA engagement">
                <span
                  className={`badge ${
                    o.sales_cooperation === 'poor' ? 'badge-danger' : 'badge-success'
                  }`}
                >
                  {o.sales_cooperation}
                </span>
              </Field>
              <Field label="Lead not interested">
                {o.lead_not_interested ? (
                  <span className="badge badge-info">true</span>
                ) : (
                  <span className="badge badge-gray">false</span>
                )}
              </Field>
              <Field label="Admin Reassign">
                {o.reassign ? (
                  <span className="inline-flex items-center gap-1 text-amber-800 font-medium">
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Enabled
                  </span>
                ) : (
                  <span className="text-gray-500">Not needed</span>
                )}
              </Field>
              <Field label="Reassign reason">
                <p className="text-xs sm:text-sm text-gray-700 leading-snug">{o.reason}</p>
              </Field>
              <Field label="Summary">
                <p className="text-xs sm:text-sm text-gray-700 leading-snug">{o.summary}</p>
              </Field>
            </dl>
            <p className="text-[11px] text-gray-500 flex items-start gap-1 pt-2 border-t border-gray-100">
              <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              On a real lead, open Details → Meetings to fetch/process a recording; the table then
              shows Call language, Join %, and Reassign from the latest meeting.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Demo lead CSV (optional)</h2>
        <p className="text-xs text-gray-500 mb-3">
          Upload on Lead Intake. Preferred is optional; Call language stays empty until a call is
          processed.
        </p>
        <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto leading-relaxed">
{`name,email,phone,preferred_language
Priya Nair,priya.demo@leadtest.com,9876501001,Hindi
Rahul Sharma,rahul.demo@leadtest.com,9876501002,Hindi
Meena Iyer,meena.demo@leadtest.com,9876501003,Tamil
Arjun Kumar,arjun.demo@leadtest.com,9876501004,English`}
        </pre>
      </section>
    </div>
  );
};

export default AiHowItWorks;
