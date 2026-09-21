import React from 'react';

/** Inline spinner for buttons and small UI. */
export const Spinner = ({ className = 'w-4 h-4' }) => (
  <span
    className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    aria-hidden="true"
  />
);

/** Full-area page/section loader. */
export const PageLoader = ({ className = 'h-64' }) => (
  <div className={`flex items-center justify-center ${className}`}>
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
  </div>
);

export default Spinner;
