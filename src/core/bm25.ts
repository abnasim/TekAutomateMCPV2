export interface Bm25Doc {
  id: string;
  text: string;
  meta?: Record<string, unknown>;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_:.?]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 1);
}

export class Bm25Index<T extends Bm25Doc> {
  private readonly docs: T[];
  private readonly docLengths: number[];
  private readonly postings = new Map<string, Array<{ docIdx: number; tf: number }>>();
  private readonly avgDocLength: number;

  constructor(docs: T[]) {
    this.docs = docs;
    this.docLengths = new Array(docs.length).fill(0);
    let total = 0;
    docs.forEach((doc, docIdx) => {
      const tokens = tokenize(doc.text || '');
      this.docLengths[docIdx] = tokens.length;
      total += tokens.length;
      const tfMap = new Map<string, number>();
      tokens.forEach((t) => tfMap.set(t, (tfMap.get(t) || 0) + 1));
      tfMap.forEach((tf, token) => {
        const list = this.postings.get(token) || [];
        list.push({ docIdx, tf });
        this.postings.set(token, list);
      });
    });
    this.avgDocLength = docs.length ? total / docs.length : 1;
  }

  search(query: string, limit = 10): Array<{ doc: T; score: number }> {
    const q = tokenize(query);
    if (!q.length || !this.docs.length) return [];
    const k1 = 1.2;
    const b = 0.75;
    const N = this.docs.length;
    const scores = new Map<number, number>();

    q.forEach((token) => {
      const posting = this.postings.get(token);
      if (!posting?.length) return;
      const df = posting.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      posting.forEach(({ docIdx, tf }) => {
        const dl = this.docLengths[docIdx] || 1;
        const numer = tf * (k1 + 1);
        const denom = tf + k1 * (1 - b + (b * dl) / this.avgDocLength);
        const score = idf * (numer / denom);
        scores.set(docIdx, (scores.get(docIdx) || 0) + score);
      });
    });

    return Array.from(scores.entries())
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, Math.max(1, limit))
      .map(([idx, score]) => ({ doc: this.docs[idx], score }));
  }
}
