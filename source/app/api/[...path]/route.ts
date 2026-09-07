export const dynamic = 'force-dynamic';

async function proxy(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const allowedOrigin = process.env.LAB_PUBLIC_ORIGIN || url.origin;
  if (!['GET', 'HEAD'].includes(request.method) && origin !== allowedOrigin) {
    return Response.json(
      { error: '请求来源不正确，请刷新页面重试。' },
      { status: 403 },
    );
  }
  const key = process.env.LAB_SERVICE_KEY;
  if (!key)
    return Response.json({ error: '数据服务尚未配置。' }, { status: 503 });
  const headers = new Headers({
    'x-lab-service-key': key,
    'content-type': 'application/json',
  });
  headers.set('cookie', request.headers.get('cookie') || '');
  // Do not trust browser-supplied forwarding headers for rate limits.
  headers.set('x-lab-client-ip', 'same-origin');
  try {
    let body: string | undefined;
    if (!['GET', 'HEAD'].includes(request.method)) {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 8 * 1024 * 1024) {
            await reader.cancel();
            return Response.json({ error: '数据过大。' }, { status: 413 });
          }
          chunks.push(value);
        }
      const joined = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      body = new TextDecoder().decode(joined);
    }
    const upstream = await fetch(
      `${process.env.LAB_API_URL || 'http://127.0.0.1:8788'}${url.pathname}${url.search}`,
      {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(30000),
      },
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch {
    return Response.json(
      { error: '暂时无法连接数据服务，请保持页面打开，稍后重试。' },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
