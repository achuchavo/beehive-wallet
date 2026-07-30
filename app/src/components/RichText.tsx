import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Renders the announcement body: a deliberately tiny markdown subset.
 *
 *   ## / ###   headings          - list items (consecutive lines group)
 *   **bold**   [label](target)   blank line = new paragraph, newline = break
 *
 * Safety is structural, not sanitised: the text is parsed into React elements,
 * so anything that isn't one of these forms is rendered as literal text - raw
 * HTML in the source stays visible as angle brackets, it never becomes markup.
 * Link targets are whitelisted: "/path" navigates in-app via react-router,
 * "https://…" opens a new tab; every other scheme (javascript:, data:, …) is
 * refused and the label is printed as plain text.
 */
export default function RichText({ text }: { text: string }) {
  return <div className="space-y-2.5">{parseBlocks(text)}</div>
}

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyBase}-${n++}`
    if (m[3] !== undefined) {
      out.push(<strong key={key}>{m[3]}</strong>)
    } else {
      out.push(renderLink(m[1], m[2], key))
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function renderLink(label: string, target: string, key: string): ReactNode {
  // In-app: "/path" but not "//host" (protocol-relative escapes the app).
  if (target.startsWith('/') && !target.startsWith('//')) {
    return (
      <Link key={key} to={target} className="font-medium text-amber-700 underline">
        {label}
      </Link>
    )
  }
  if (/^https?:\/\//i.test(target)) {
    return (
      <a
        key={key}
        href={target}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-amber-700 underline"
      >
        {label}
      </a>
    )
  }
  // Unknown scheme: show the words, drop the destination.
  return label
}

/** Lines of one paragraph, joined with <br/> between them. */
function paragraph(lines: string[], key: string): ReactNode {
  const parts: ReactNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) parts.push(<br key={`${key}-br${i}`} />)
    parts.push(...renderInline(line, `${key}-l${i}`))
  })
  return (
    <p key={key} className="text-sm leading-relaxed text-slate-600">
      {parts}
    </p>
  )
}

function parseBlocks(text: string): ReactNode[] {
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: string[] = []
  let n = 0

  const flush = () => {
    if (para.length > 0) {
      blocks.push(paragraph(para, `b${n++}`))
      para = []
    }
    if (list.length > 0) {
      const key = `b${n++}`
      blocks.push(
        <ul key={key} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
          {list.map((item, i) => (
            <li key={`${key}-i${i}`}>{renderInline(item, `${key}-i${i}`)}</li>
          ))}
        </ul>,
      )
      list = []
    }
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') {
      flush()
    } else if (line.startsWith('### ')) {
      flush()
      blocks.push(
        <h4 key={`b${n++}`} className="pt-1 text-sm font-semibold text-slate-800">
          {renderInline(line.slice(4), `b${n}`)}
        </h4>,
      )
    } else if (line.startsWith('## ')) {
      flush()
      blocks.push(
        <h3 key={`b${n++}`} className="pt-1 text-[15px] font-semibold text-slate-800">
          {renderInline(line.slice(3), `b${n}`)}
        </h3>,
      )
    } else if (line.startsWith('- ')) {
      if (para.length > 0) flush()
      list.push(line.slice(2))
    } else {
      if (list.length > 0) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
}
