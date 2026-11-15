import { getApp } from '../server/app.js';

export const maxDuration = 300;

function restoreRewrittenRequest(request) {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get('__mh_path');
  if (!rewrittenPath) return request;

  url.pathname = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
  url.searchParams.delete('__mh_path');

  return new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    duplex: request.method === 'GET' || request.method === 'HEAD' ? undefined : 'half',
  });
}

async function dispatch(request) {
  try {
    const app = await getApp();
    return await app.fetch(restoreRewrittenRequest(request));
  } catch (error) {
    console.error('[mutualhouse-api]', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
export const OPTIONS = dispatch;
export const HEAD = dispatch;
