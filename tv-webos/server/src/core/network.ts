import os from 'node:os';

/** Non-internal IPv4 addresses of this machine, private LAN ranges first. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return out.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

/**
 * Base URL phones should use to reach this server.
 *
 * Priority: PUBLIC_URL > the Host the TV itself used (when it is not
 * localhost) > first LAN address.
 */
export function resolvePublicBase(opts: {
  publicUrl: string;
  port: number;
  requestHost?: string;
  requestProto?: string;
}): string {
  if (opts.publicUrl) return opts.publicUrl;
  const host = opts.requestHost;
  if (host && !/^(localhost|127\.|\[::1\]|::1)/i.test(host)) {
    return `${opts.requestProto === 'https' ? 'https' : 'http'}://${host}`;
  }
  const ip = lanAddresses()[0] ?? '127.0.0.1';
  return `http://${ip}:${opts.port}`;
}
