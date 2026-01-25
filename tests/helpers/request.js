import { EventEmitter } from 'node:events';
import { Duplex, Readable } from 'node:stream';

function parseCookies(header) {
  const map = new Map();
  if (!header) return map;
  header.split(';').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const name = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    map.set(name, value);
  });
  return map;
}

function mergeCookies(existing, setCookieHeader) {
  const map = parseCookies(existing);
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader];
  cookies.forEach((cookie) => {
    const pair = cookie.split(';')[0];
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) return;
    const name = pair.slice(0, eqIndex);
    const value = pair.slice(eqIndex + 1);
    map.set(name, value);
  });
  return Array.from(map.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function createRequest({ method, path, headers, body }) {
  const req = new Readable({
    read() {},
  });
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  socket.encrypted = false;
  req.method = method;
  req.url = path;
  req.headers = headers;
  req.socket = socket;
  req.connection = socket;

  if (body !== undefined) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    req.push(payload);
    req.push(null);
  } else {
    req.push(null);
  }

  return req;
}

function createResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res._header = false;
  res.finished = false;
  res.headers = {};
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  res.getHeader = (name) => res.headers[name.toLowerCase()];
  res.removeHeader = (name) => {
    delete res.headers[name.toLowerCase()];
  };
  res.writeHead = (statusCode, headers) => {
    res.statusCode = statusCode;
    res._header = true;
    if (headers) {
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }
  };
  res._implicitHeader = () => {
    if (!res._header) {
      res.writeHead(res.statusCode);
    }
  };
  const chunks = [];
  res.write = (chunk, encoding, callback) => {
    if (!res._header) {
      res._implicitHeader();
    }
    if (chunk !== undefined) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };
  res.end = (chunk) => {
    if (!res._header) {
      res._implicitHeader();
    }
    if (chunk !== undefined) {
      res.write(chunk);
    }
    res.body = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
    res.finished = true;
    res.emit('finish');
  };
  Object.defineProperty(res, 'headersSent', {
    get() {
      return res._header || res.finished;
    },
  });
  return res;
}

export function createTestClient(app) {
  let cookieHeader = '';

  async function request(method, path, { body, headers = {} } = {}) {
    const normalizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key.toLowerCase(),
        value,
      ])
    );

    if (cookieHeader) {
      normalizedHeaders.cookie = cookieHeader;
    }

    if (body !== undefined && !normalizedHeaders['content-type']) {
      normalizedHeaders['content-type'] = 'application/json';
    }

    if (body !== undefined) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      normalizedHeaders['content-length'] = Buffer.byteLength(payload).toString();
    }

    const req = createRequest({
      method: method.toUpperCase(),
      path,
      headers: normalizedHeaders,
      body,
    });
    const res = createResponse();
    res.req = req;
    req.res = res;
    req.originalUrl = path;

    await new Promise((resolve, reject) => {
      res.on('finish', resolve);
      res.on('error', reject);
      app.handle(req, res);
    });

    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      cookieHeader = mergeCookies(cookieHeader, setCookie);
    }

    let responseBody = res.body;
    const contentType = res.headers['content-type'] || '';
    if (responseBody && contentType.includes('application/json')) {
      try {
        responseBody = JSON.parse(responseBody);
      } catch (error) {
        // Leave as text if JSON parsing fails.
      }
    } else if (responseBody === '') {
      responseBody = null;
    }

    return {
      status: res.statusCode,
      headers: res.headers,
      body: responseBody,
      text: res.body,
    };
  }

  return {
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),
  };
}
