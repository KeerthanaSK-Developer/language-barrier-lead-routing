/** Normalize FastAPI / axios error payloads into a readable string. */
export function getErrorMessage(error, fallback = 'Something went wrong') {
  const detail = error?.response?.data?.detail;
  if (detail == null) {
    return error?.message || fallback;
  }
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === 'string' ? d : d.msg || JSON.stringify(d)))
      .join(', ');
  }
  if (typeof detail === 'object' && detail.message) return detail.message;
  return String(detail);
}
