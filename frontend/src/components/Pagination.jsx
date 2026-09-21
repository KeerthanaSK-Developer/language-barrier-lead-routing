import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE_OPTIONS = [5, 10, 25];

/**
 * Server-driven pagination controls.
 * Uses a button group for page size (avoids native <select> misplacement on mobile).
 */
const Pagination = ({
  page = 1,
  pageSize = 10,
  total = 0,
  totalPages = 0,
  onPageChange,
  onPageSizeChange,
  disabled = false,
}) => {
  const pages = totalPages || (total > 0 ? Math.ceil(total / pageSize) : 0);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="relative z-20 flex flex-col gap-3 px-4 py-3 border-t border-gray-100 bg-white">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-gray-600">
          {total === 0 ? 'No results' : `Showing ${from}–${to} of ${total}`}
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled || page <= 1}
            onClick={() => onPageChange?.(page - 1)}
            className="btn-secondary flex items-center gap-1 py-1.5 px-3 text-sm disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>
          <span className="text-sm text-gray-600 min-w-[4.5rem] text-center tabular-nums">
            {pages === 0 ? '0 / 0' : `${page} / ${pages}`}
          </span>
          <button
            type="button"
            disabled={disabled || pages === 0 || page >= pages}
            onClick={() => onPageChange?.(page + 1)}
            className="btn-secondary flex items-center gap-1 py-1.5 px-3 text-sm disabled:opacity-40"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-start gap-3">
        <span className="text-sm text-gray-500 whitespace-nowrap">Per page</span>
        <div
          className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white"
          role="group"
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((n) => {
            const active = pageSize === n;
            return (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (!active) onPageSizeChange?.(n);
                }}
                className={`min-w-[2.75rem] px-3 py-1.5 text-sm font-medium transition-colors border-r border-gray-300 last:border-r-0 disabled:opacity-40 ${
                  active
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Pagination;
