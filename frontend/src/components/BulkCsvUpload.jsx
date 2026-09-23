import React, { useRef, useState } from 'react';
import { Upload, Download, CheckCircle, XCircle, Loader2, Ban, Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errors';

/**
 * Shared bulk CSV uploader.
 * - No header row expected
 * - Shows column order to follow
 * - Processes each row with progress
 * - Statuses: created | other (duplicate email) | failed
 * - Downloads results CSV with reason column
 */
const BulkCsvUpload = ({
  title,
  columns,
  exampleRows = [],
  processRow,
  resultColumns,
  onComplete,
  onClose,
  emailColumnIndex = 1,
}) => {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [progress, setProgress] = useState([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [copiedRow, setCopiedRow] = useState(null);

  const parseCsv = (text) => {
    // RFC-style parse: commas/newlines inside "..." stay in the same cell/row.
    const input = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      const next = input[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          current += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current.trim());
        current = '';
      } else if (ch === '\n') {
        row.push(current.trim());
        current = '';
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
      } else if (ch === '\r') {
        // handle CRLF / CR
        if (next === '\n') i += 1;
        row.push(current.trim());
        current = '';
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
      } else {
        current += ch;
      }
    }

    row.push(current.trim());
    if (row.some((cell) => cell !== '')) rows.push(row);

    // Skip header row if present (name,email,...)
    if (rows.length > 0) {
      const first = rows[0].map((c) => String(c || '').toLowerCase());
      if (first[0] === 'name' && (first[1] === 'email' || first.includes('email'))) {
        return rows.slice(1);
      }
    }
    return rows;
  };

  const isDuplicateError = (err, reasonText) => {
    const status = err?.response?.status;
    const detail = String(reasonText || '').toLowerCase();
    return (
      status === 409 ||
      detail.includes('already exists') ||
      detail.includes('duplicate') ||
      detail.includes('email already')
    );
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload a .csv file');
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      toast.error('CSV file is empty');
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    setProgress([]);
    setDone(false);
  };

  const runUpload = async () => {
    if (rows.length === 0) {
      toast.error('Select a CSV file first');
      return;
    }

    setRunning(true);
    setDone(false);
    const results = [];
    const seenEmails = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const label = row[0] || `Row ${i + 1}`;
      const email = String(row[emailColumnIndex] || '').trim().toLowerCase();
      const rowData = Object.fromEntries(columns.map((c, idx) => [c.key, row[idx] ?? '']));

      setProgress((prev) => [
        ...prev,
        { row: i + 1, label, status: 'processing', reason: 'Processing...', data: rowData },
      ]);

      // Duplicate within the same CSV file
      if (email && seenEmails.has(email)) {
        const entry = {
          row: i + 1,
          label,
          status: 'other',
          reason: 'Skipped — duplicate email in this file',
          data: rowData,
        };
        results.push(entry);
        setProgress((prev) => {
          const next = [...prev];
          next[i] = entry;
          return next;
        });
        continue;
      }
      if (email) seenEmails.add(email);

      try {
        const result = await processRow(row, i);
        const status = result?.status || 'created';
        const entry = {
          row: i + 1,
          label,
          status,
          reason: result?.reason || (status === 'other' ? 'Skipped — email already exists' : 'Created successfully'),
          data: result?.data || rowData,
          copyText: result?.copyText || '',
          copyLabel: result?.copyLabel || 'Copy',
        };
        results.push(entry);
        setProgress((prev) => {
          const next = [...prev];
          next[i] = entry;
          return next;
        });
      } catch (err) {
        const reasonText = getErrorMessage(err, 'Failed to create');
        const status = isDuplicateError(err, reasonText) ? 'other' : 'failed';
        const entry = {
          row: i + 1,
          label,
          status,
          reason: status === 'other'
            ? (reasonText.includes('already') ? reasonText : 'Skipped — email already exists')
            : reasonText,
          data: rowData,
        };
        results.push(entry);
        setProgress((prev) => {
          const next = [...prev];
          next[i] = entry;
          return next;
        });
      }
    }

    setRunning(false);
    setDone(true);
    onComplete?.(results);
  };

  const downloadResults = () => {
    const headers = resultColumns.map((c) => c.label);
    const lines = [headers.join(',')];

    progress.forEach((item) => {
      const values = resultColumns.map((col) => {
        let val = '';
        if (col.key === 'row') val = item.row;
        else if (col.key === 'status') val = item.status;
        else if (col.key === 'reason') val = item.reason;
        else if (col.key === 'label') val = item.label;
        else val = item.data?.[col.key] ?? '';
        const str = String(val ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      });
      lines.push(values.join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_').toLowerCase()}_results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyRow = async (item) => {
    try {
      await navigator.clipboard.writeText(item.copyText);
      setCopiedRow(item.row);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy. Select the text instead.');
    }
  };

  const created = progress.filter((p) => p.status === 'created').length;
  const other = progress.filter((p) => p.status === 'other').length;
  const failed = progress.filter((p) => p.status === 'failed').length;
  const pct = rows.length
    ? Math.round((progress.filter((p) => p.status !== 'processing').length / rows.length) * 100)
    : 0;

  const statusIcon = (status) => {
    if (status === 'processing') return <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />;
    if (status === 'created') return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (status === 'other') return <Ban className="w-4 h-4 text-amber-500" />;
    if (status === 'failed') return <XCircle className="w-4 h-4 text-red-600" />;
    return null;
  };

  const reasonClass = (status) => {
    if (status === 'failed') return 'text-red-600';
    if (status === 'other') return 'text-amber-600';
    return 'text-gray-500';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold mb-2">{title}</h2>
        <p className="text-sm text-gray-600 mb-4">
          Upload a CSV file. A header row is OK (it will be skipped). Follow this column order.
          Put the full call transcript in one cell (quotes around it if it has commas or line breaks).
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 overflow-x-auto">
          <p className="text-xs font-semibold text-gray-500 mb-2">Column order</p>
          <div className="flex flex-wrap gap-2">
            {columns.map((col, i) => (
              <span key={col.key} className="badge badge-info">
                {i + 1}. {col.label}
              </span>
            ))}
          </div>
          {exampleRows.length > 0 && (
            <pre className="mt-3 text-xs text-gray-600 font-mono whitespace-pre-wrap">
              {exampleRows.map((r) => r.join(',')).join('\n')}
            </pre>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFile}
            disabled={running}
          />
          <button
            type="button"
            className="btn-secondary flex items-center gap-2"
            onClick={() => fileRef.current?.click()}
            disabled={running}
          >
            <Upload className="w-4 h-4" />
            Choose CSV File
          </button>
          {fileName && <span className="text-sm text-gray-600">{fileName} ({rows.length} rows)</span>}
        </div>

        {(running || done) && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-600">Progress</span>
              <span className="font-medium text-gray-900">{pct}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            {done && (
              <p className="text-sm text-gray-600 mt-2">
                Created: <span className="text-green-600 font-medium">{created}</span>
                {' · '}
                Other: <span className="text-amber-600 font-medium">{other}</span>
                {' · '}
                Failed: <span className="text-red-600 font-medium">{failed}</span>
                {progress.some((item) => item.copyText) && (
                  <span className="block text-amber-800 mt-1">
                    Copy each value before you close this window. The results CSV includes them too.
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {progress.length > 0 && (
          <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto mb-4">
            {progress.map((item) => (
              <div key={item.row} className="flex items-start gap-3 px-3 py-2 border-b border-gray-100 last:border-0 text-sm">
                <div className="mt-0.5">{statusIcon(item.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 truncate">
                      Row {item.row}: {item.label}
                    </p>
                    {item.status === 'other' && (
                      <span className="badge badge-warning text-[10px]">other</span>
                    )}
                    {item.status === 'created' && (
                      <span className="badge badge-success text-[10px]">created</span>
                    )}
                    {item.status === 'failed' && (
                      <span className="badge badge-danger text-[10px]">failed</span>
                    )}
                  </div>
                  <p className={`text-xs ${reasonClass(item.status)}`}>
                    {item.reason}
                  </p>
                  {item.copyText && (
                    <div className="mt-1 flex items-start gap-2">
                      <pre className="text-xs font-mono text-gray-900 bg-white border border-gray-200 rounded px-2 py-1 whitespace-pre-wrap break-all flex-1">
                        {item.copyText}
                      </pre>
                      <button
                        type="button"
                        onClick={() => copyRow(item)}
                        className="text-primary-600 hover:text-primary-700 text-xs font-medium flex items-center gap-1 flex-shrink-0"
                      >
                        {copiedRow === item.row ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedRow === item.row ? 'Copied' : (item.copyLabel || 'Copy')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row flex-wrap gap-3">
          {!done && (
            <button
              type="button"
              onClick={runUpload}
              className="btn-primary flex-1"
              disabled={running || rows.length === 0}
            >
              {running ? 'Uploading...' : 'Start Upload'}
            </button>
          )}
          {done && (
            <button type="button" onClick={downloadResults} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Download className="w-4 h-4" />
              Download Results CSV
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex-1"
            disabled={running}
          >
            {done ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkCsvUpload;
