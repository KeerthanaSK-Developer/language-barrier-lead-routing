import React from 'react';
import { Sparkles } from 'lucide-react';

function joinBadgeClass(prob) {
  if (prob == null || Number.isNaN(Number(prob))) return 'badge-gray';
  const n = Number(prob);
  if (n >= 70) return 'badge-success';
  if (n >= 40) return 'badge-warning';
  return 'badge-danger';
}

/**
 * Compact post-call fields for BDA / admin follow-up (no raw transcript).
 */
const LeadCallInsightsCard = ({ lead, compact = false }) => {
  const insights = lead?.last_call_insights;
  if (
    !insights
    || (
      !insights.summary
      && insights.join_probability == null
      && !(insights.languages_detected || []).length
      && !(insights.next_actions_for_bda || []).length
    )
  ) {
    return null;
  }

  const joinProb =
    insights.join_probability != null
      ? Number(insights.join_probability)
      : lead?.call_join_probability != null
        ? Number(lead.call_join_probability)
        : null;
  const languages = insights.languages_detected?.length
    ? insights.languages_detected
    : lead?.callLanguages || lead?.transcriptedLanguages || [];
  const courses = insights.preferred_courses_or_topics || [];
  const nextActions = insights.next_actions_for_bda || [];
  const objections = insights.objections || [];

  if (compact) {
    return (
      <div className="text-xs space-y-1 min-w-[10rem]">
        {joinProb != null && !Number.isNaN(joinProb) && (
          <div>
            <span className={`badge ${joinBadgeClass(joinProb)}`}>Join {joinProb}%</span>
          </div>
        )}
        {languages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {languages.slice(0, 3).map((lang) => (
              <span key={lang} className="badge badge-warning">{lang}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-lg border border-amber-100 bg-amber-50/60">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 mb-2">
        <Sparkles className="w-3.5 h-3.5" />
        After-call follow-up
      </div>
      <div className="text-sm">
        <p className="text-xs text-gray-500">Join probability</p>
        {joinProb != null && !Number.isNaN(joinProb) ? (
          <span className={`badge ${joinBadgeClass(joinProb)} mt-0.5`}>{joinProb}%</span>
        ) : (
          <p className="font-medium text-gray-400">—</p>
        )}
      </div>

      {languages.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-1">Call language</p>
          <div className="flex flex-wrap gap-1">
            {languages.map((lang) => (
              <span key={lang} className="badge badge-warning">{lang}</span>
            ))}
          </div>
        </div>
      )}

      {(insights.language_barrier || insights.sales_cooperation === 'poor') && (
        <div className="mt-2 p-2 rounded bg-red-50 border border-red-100 text-xs text-red-800">
          {insights.language_barrier && (
            <p>Language barrier: {insights.language_barrier_reason || 'Detected'}</p>
          )}
          {insights.sales_cooperation === 'poor' && (
            <p className="mt-0.5">Cooperation: {insights.cooperation_reason || 'Poor'}</p>
          )}
        </div>
      )}

      {courses.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-1">Courses / topics</p>
          <p className="text-sm text-gray-800">{courses.join(', ')}</p>
        </div>
      )}

      {insights.best_callback_time && (
        <div className="mt-2">
          <p className="text-xs text-gray-500">Best callback</p>
          <p className="text-sm text-gray-800">{insights.best_callback_time}</p>
        </div>
      )}

      {insights.summary && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-0.5">Summary</p>
          <p className="text-sm text-gray-800">{insights.summary}</p>
        </div>
      )}

      {nextActions.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-0.5">Next actions (BDA)</p>
          <ul className="text-sm text-gray-800 list-disc pl-4 space-y-0.5">
            {nextActions.slice(0, 4).map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {objections.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-0.5">Objections</p>
          <p className="text-sm text-gray-700">{objections.slice(0, 3).join(' · ')}</p>
        </div>
      )}

      {(insights.risk_flags || []).length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 mb-0.5">Risk flags</p>
          <p className="text-sm text-red-700">{insights.risk_flags.slice(0, 3).join(' · ')}</p>
        </div>
      )}
    </div>
  );
};

export default LeadCallInsightsCard;
