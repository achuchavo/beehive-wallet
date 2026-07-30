// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import RichText from './RichText'

/**
 * The renderer's whole job is to make rich announcements impossible to abuse:
 * markup comes out as React elements built from text, never as parsed HTML,
 * and link targets outside the whitelist are dropped. These tests pin the
 * security-relevant behaviour more than the typography.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(text: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <MemoryRouter>
        <RichText text={text} />
      </MemoryRouter>,
    )
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('RichText safety', () => {
  it('renders raw HTML as literal text, never as markup', () => {
    const el = render('hello <img src=x onerror=alert(1)> <b>bold?</b>')
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('b')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('refuses javascript: and data: link targets, keeping only the label', () => {
    const el = render('[click me](javascript:alert(1)) and [data](data:text/html,x)')
    expect(el.querySelector('a')).toBeNull()
    expect(el.textContent).toContain('click me')
    expect(el.textContent).not.toContain('javascript:')
  })

  it('refuses protocol-relative //host targets', () => {
    const el = render('[out](//evil.example/path)')
    expect(el.querySelector('a')).toBeNull()
    expect(el.textContent).toContain('out')
  })

  it('renders an in-app /path as a router link', () => {
    const el = render('go to [alerts](/alarms)')
    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/alarms')
    expect(a.textContent).toBe('alerts')
    // In-app: same tab, no external-link attributes.
    expect(a.getAttribute('target')).toBeNull()
  })

  it('renders an https link with new-tab + noopener', () => {
    const el = render('[docs](https://example.com/a)')
    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com/a')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
  })
})

describe('RichText structure', () => {
  it('renders headings, bold, lists and paragraphs', () => {
    const el = render('## Title\n\nSome **strong** text.\n\n- one\n- two')
    expect(el.querySelector('h3')!.textContent).toBe('Title')
    expect(el.querySelector('strong')!.textContent).toBe('strong')
    const items = el.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toBe('one')
  })

  it('splits paragraphs on blank lines and breaks on single newlines', () => {
    const el = render('line one\nline two\n\nsecond para')
    const ps = el.querySelectorAll('p')
    expect(ps).toHaveLength(2)
    expect(ps[0].querySelector('br')).not.toBeNull()
    expect(ps[1].textContent).toBe('second para')
  })

  it('supports inline formatting inside list items and headings', () => {
    const el = render('### Watch **any** address\n- link to [alerts](/alarms)')
    expect(el.querySelector('h4 strong')!.textContent).toBe('any')
    expect(el.querySelector('li a')!.getAttribute('href')).toBe('/alarms')
  })
})
