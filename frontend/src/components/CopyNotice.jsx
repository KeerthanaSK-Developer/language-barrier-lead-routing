import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Temporary on-screen copy of something that would otherwise only arrive by email.
 * Disappears after `seconds` (default 60).
 */
const CopyNotice = ({ title, hint, lines = [], copyText, copyLabel = 'Copy', seconds = 60, onExpire }) => {
  const [left, setLeft] = useState(seconds);
  const [copied, setCopied] = useState(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    setLeft(seconds);
    setCopied(false);
  }, [copyText, seconds]);

  useEffect(() => {
    if (left <= 0) {
      onExpireRef.current?.();
      return undefined;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy. Select the text instead.');
    }
  };

  const mins = Math.floor(left / 60);
  const secs = String(left % 60).padStart(2, '0');

  return (
    <div className="card border border-amber-300 bg-amber-50">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">{title}</p>
          {hint && <p className="text-sm text-amber-800 mt-1">{hint}</p>}
          <dl className="mt-3 space-y-1">
            {lines.map((line) => (
              <div key={line.label} className="flex flex-wrap gap-x-2 text-sm">
                <dt className="text-gray-500">{line.label}</dt>
                <dd className="font-mono text-gray-900 break-all">{line.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2 flex-shrink-0">
          <button type="button" onClick={handleCopy} className="btn-primary flex items-center justify-center gap-2">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : copyLabel}
          </button>
          <p className="text-xs text-amber-800 text-center sm:text-right">Hides in {mins}:{secs}</p>
        </div>
      </div>
    </div>
  );
};

export default CopyNotice;
