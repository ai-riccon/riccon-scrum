import { createElement, Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="md-code">{p.slice(1, -1)}</code>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

const parseRow = (r: string) => r.split('|').slice(1, -1).map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++} className="md-pre">{buf.join('\n')}</pre>);
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      const level = (line.match(/^#+/) as RegExpMatchArray)[0].length;
      blocks.push(createElement(`h${Math.min(level + 1, 5)}`, { key: key++, className: `md-h md-h${level}` }, inline(line.replace(/^#+\s/, ''))));
      i++;
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const header = parseRow(rows[0]);
      const body = rows.slice(2).map(parseRow);
      blocks.push(
        <table key={key++} className="md-table">
          <thead><tr>{header.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) items.push(lines[i++].replace(/^[-*]\s/, ''));
      blocks.push(<ul key={key++} className="md-ul">{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|```|\||[-*]\s)/.test(lines[i])) buf.push(lines[i++]);
    blocks.push(<p key={key++} className="md-p">{inline(buf.join(' '))}</p>);
  }
  return <div className="md">{blocks}</div>;
}