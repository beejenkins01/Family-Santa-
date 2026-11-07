export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError("Can't reach the North Pole. Check your connection?", 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(data?.error || 'Something went sideways. Try again?', res.status);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
