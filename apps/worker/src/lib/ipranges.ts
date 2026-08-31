/**
 * Classificação de endereços IP para a proteção de SSRF da §2.5.
 *
 * Regra: só endereço unicast público passa. Tudo que não for reconhecido
 * como público é rejeitado — a decisão falha fechada, nunca aberta.
 */

export interface AddressVerdict {
  address: string
  version: 4 | 6 | null
  isPublic: boolean
  /** Nome da faixa que barrou, para virar evidência legível. */
  blockedBy: string | null
}

function ipv4ToBytes(input: string): number[] | null {
  const parts = input.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    out.push(n)
  }
  return out
}

/** Faixas IPv4 não roteáveis publicamente. [primeiro octeto/máscara, rótulo] */
const V4_BLOCKS: Array<[number, number, string]> = [
  [0x00000000, 8, 'this-network 0.0.0.0/8'],
  [0x0a000000, 8, 'privada 10.0.0.0/8'],
  [0x64400000, 10, 'CGNAT 100.64.0.0/10'],
  [0x7f000000, 8, 'loopback 127.0.0.0/8'],
  [0xa9fe0000, 16, 'link-local 169.254.0.0/16'],
  [0xac100000, 12, 'privada 172.16.0.0/12'],
  [0xc0000000, 24, 'IETF protocol 192.0.0.0/24'],
  [0xc0000200, 24, 'documentação 192.0.2.0/24'],
  [0xc0586300, 24, '6to4 relay 192.88.99.0/24'],
  [0xc0a80000, 16, 'privada 192.168.0.0/16'],
  [0xc6120000, 15, 'benchmark 198.18.0.0/15'],
  [0xc6336400, 24, 'documentação 198.51.100.0/24'],
  [0xcb007100, 24, 'documentação 203.0.113.0/24'],
  [0xe0000000, 4, 'multicast 224.0.0.0/4'],
  [0xf0000000, 4, 'reservado 240.0.0.0/4'],
]

function classifyV4Bytes(b: number[]): { isPublic: boolean; blockedBy: string | null } {
  const n = (((b[0] ?? 0) << 24) >>> 0) + ((b[1] ?? 0) << 16) + ((b[2] ?? 0) << 8) + (b[3] ?? 0)
  for (const [base, bits, label] of V4_BLOCKS) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    // `>>> 0` nos DOIS lados: sem isso o & devolve int32 com sinal e toda
    // faixa com primeiro octeto >= 128 (192.168/16, 169.254/16, 240/4...) escapa.
    if (((n & mask) >>> 0) === ((base & mask) >>> 0)) {
      return { isPublic: false, blockedBy: label }
    }
  }
  return { isPublic: true, blockedBy: null }
}

/** Expande a parte hexadecimal de um IPv6 em `expected` grupos de 16 bits. */
function expandGroups(s: string, expected: number): number[] | null {
  const parts = s.split('::')
  if (parts.length > 2) return null

  const head = parts[0] ? parts[0].split(':') : []
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : []

  let groups: string[]
  if (parts.length === 1) {
    if (head.length !== expected) return null
    groups = head
  } else {
    const fill = expected - head.length - tail.length
    if (fill < 0) return null
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail]
  }
  if (groups.length !== expected) return null

  const out: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    out.push(parseInt(g, 16))
  }
  return out
}

function ipv6ToBytes(input: string): number[] | null {
  // Remove zone id (fe80::1%eth0)
  const pct = input.indexOf('%')
  let s = pct === -1 ? input : input.slice(0, pct)

  // Forma com IPv4 embutido (::ffff:127.0.0.1, 64:ff9b::10.0.0.1)
  const lastColon = s.lastIndexOf(':')
  if (lastColon !== -1 && s.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4ToBytes(s.slice(lastColon + 1))
    if (!v4) return null
    const headPart = s.slice(0, lastColon + 1)
    // `::ffff:1.2.3.4` -> head `::ffff:`; tiramos o ':' final salvo quando é '::'
    const normalized = headPart.endsWith('::') ? headPart : headPart.slice(0, -1)
    const groups = expandGroups(normalized, 6)
    if (!groups) return null
    const bytes: number[] = []
    for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff)
    return [...bytes, ...v4]
  }

  const groups = expandGroups(s, 8)
  if (!groups) return null
  const bytes: number[] = []
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff)
  return bytes
}

function classifyV6Bytes(b: number[]): { isPublic: boolean; blockedBy: string | null } {
  const at = (i: number) => b[i] ?? 0
  const allZeroUntil = (n: number) => b.slice(0, n).every((x) => x === 0)

  // ::/128 e ::1/128
  if (allZeroUntil(16)) return { isPublic: false, blockedBy: 'não especificado ::' }
  if (allZeroUntil(15) && at(15) === 1) return { isPublic: false, blockedBy: 'loopback ::1' }

  // IPv4-mapeado ::ffff:a.b.c.d — classifica pela regra IPv4
  if (allZeroUntil(10) && at(10) === 0xff && at(11) === 0xff) {
    const v4 = classifyV4Bytes(b.slice(12, 16))
    return v4.isPublic
      ? { isPublic: true, blockedBy: null }
      : { isPublic: false, blockedBy: `IPv4-mapeado -> ${v4.blockedBy}` }
  }

  // NAT64 64:ff9b::/96 — idem
  if (at(0) === 0x00 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    const v4 = classifyV4Bytes(b.slice(12, 16))
    return v4.isPublic
      ? { isPublic: true, blockedBy: null }
      : { isPublic: false, blockedBy: `NAT64 -> ${v4.blockedBy}` }
  }

  if (at(0) === 0x01 && at(1) === 0x00 && b.slice(2, 8).every((x) => x === 0)) {
    return { isPublic: false, blockedBy: 'discard 100::/64' }
  }
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8) {
    return { isPublic: false, blockedBy: 'documentação 2001:db8::/32' }
  }
  if ((at(0) & 0xfe) === 0xfc) {
    return { isPublic: false, blockedBy: 'unique local fc00::/7' }
  }
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) {
    return { isPublic: false, blockedBy: 'link-local fe80::/10' }
  }
  if (at(0) === 0xff) {
    return { isPublic: false, blockedBy: 'multicast ff00::/8' }
  }
  return { isPublic: true, blockedBy: null }
}

export function classifyAddress(address: string): AddressVerdict {
  const v4 = ipv4ToBytes(address)
  if (v4) {
    const r = classifyV4Bytes(v4)
    return { address, version: 4, isPublic: r.isPublic, blockedBy: r.blockedBy }
  }
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
  const v6 = ipv6ToBytes(bare)
  if (v6) {
    const r = classifyV6Bytes(v6)
    return { address, version: 6, isPublic: r.isPublic, blockedBy: r.blockedBy }
  }
  // Não é IP reconhecível: falha fechada.
  return { address, version: null, isPublic: false, blockedBy: 'endereço não reconhecido' }
}
