// ─────────────────────────────────────────────────────────────────────────────
// Kenneth Breugelmans — CV
// Design only. All content — including section labels — lives in the content
// files, one per language: content.yaml (en), content.nl.yaml (nl).
//
//   Build:  ./scripts/build-cv.sh            both languages
//   Watch:  ./scripts/build-cv.sh watch nl
//
// The content file is selected with --input content=…; everything else in this
// file is language-agnostic.
// ─────────────────────────────────────────────────────────────────────────────

#let D = yaml(sys.inputs.at("content", default: "content.yaml"))
#let L = D.labels

// ── Palette ──────────────────────────────────────────────────────────────────
#let ink    = rgb("#16191d") // body text
#let accent = rgb("#123c5e") // deep navy — the single accent
#let muted  = rgb("#5c6672") // secondary text
#let faint  = rgb("#8d97a3") // metadata, dates
#let hair   = rgb("#dcdfe4") // rules
#let wash   = rgb("#f2f0ec") // warm paper tint

// ── Type ─────────────────────────────────────────────────────────────────────
// Source Serif 4 ships optical sizes: Display for the name, Text for body,
// Caption for the small stuff. Inter carries labels and metadata.
#let serif   = "Source Serif 4"
#let display = "Source Serif 4 Display"
#let caption = "Source Serif 4 Caption"
#let sans    = "Inter"

// ── Grid ─────────────────────────────────────────────────────────────────────
// Section names sit in a hanging label column; content occupies a single
// generous measure to its right. This is what makes the page read editorial.
#let LABELW = 2.2cm
#let GUTTER = 0.65cm

// Breathing room around the hairlines. RULE_ABOVE/BELOW frame a section rule;
// ITEM_GAP frames the lighter rules between items inside a section. These are
// the main levers on overall page fill — raising them costs a third page.
// These sit just under the two-page ceiling (3 pages from ~0.82/0.54/0.58).
#let RULE_ABOVE = 0.78em
#let RULE_BELOW = 0.50em
#let ITEM_GAP   = 0.55em

// Side margins, in centimetres, overridable per language: Dutch sets the same
// content ~10% longer than English and needs a slightly wider measure to hold
// two pages. Everything else about the design stays identical across languages.
#let MARGIN_X = D.at("layout", default: (:)).at("margin_x", default: 1.9) * 1cm

// ── Document ─────────────────────────────────────────────────────────────────
#set document(
  title: D.name + " — " + L.doctitle,
  author: D.name,
  keywords: D.keywords,
)

// ── Page ─────────────────────────────────────────────────────────────────────
#set page(
  paper: "a4",
  margin: (top: 1.35cm, bottom: 1.0cm, left: MARGIN_X, right: MARGIN_X),
  footer: context {
    set text(font: sans, size: 7pt, fill: faint)
    let cur = counter(page).get().first()
    let tot = counter(page).final().first()
    grid(
      columns: (1fr, auto),
      align(left + horizon)[#D.name — #L.doctitle],
      align(right + horizon)[#cur / #tot],
    )
  },
)

#set text(font: serif, size: 9.2pt, fill: ink, lang: D.lang, hyphenate: true)
#set par(justify: true, leading: 0.55em, spacing: 0.72em)
#show link: it => text(fill: accent, it)

// ── Components ───────────────────────────────────────────────────────────────

// Tracked uppercase sans label — used for every section name and metadata run.
// Tracking is capped at 0.08em: above that, PDF text extraction (and therefore
// any ATS keyword match) splits the words into individual letters.
#let TRACK = 0.08em
#let kicker(t, size: 7.5pt, fill: accent, weight: "medium") = text(
  font: sans, size: size, weight: weight, fill: fill, tracking: TRACK, upper(t),
)

// A section: hairline, then hanging label beside the content measure.
#let section(label, body) = block(width: 100%, above: RULE_ABOVE, below: 0em, {
  line(length: 100%, stroke: 0.5pt + hair)
  v(RULE_BELOW)
  grid(columns: (LABELW, 1fr), column-gutter: GUTTER, kicker(label), body)
})

// Proportion rule — a short bar under a stat, filled to its value.
#let METERW = 3.2cm
#let meter(frac) = {
  let f = calc.max(0.03, calc.min(0.97, frac))
  box(width: METERW, grid(
    columns: (f * 100%, (1.0 - f) * 100%),
    rect(width: 100%, height: 2pt, stroke: none, fill: accent, radius: (left: 1pt)),
    rect(width: 100%, height: 2pt, stroke: none, fill: hair, radius: (right: 1pt)),
  ))
}

// Label / value rows (engagement terms, skills, languages).
#let deflist(rows, labelw: 3.2cm) = {
  for (i, r) in rows.enumerate() {
    grid(
      columns: (labelw, 1fr), column-gutter: 0.7em,
      text(font: sans, size: 8.1pt, weight: "medium", fill: accent, r.at(0)),
      text(size: 9pt, r.at(1)),
    )
    if i < rows.len() - 1 { v(0.3em) }
  }
}

// Hairline used to separate items within a section.
#let itemrule = block(above: ITEM_GAP, below: ITEM_GAP, line(length: 100%, stroke: 0.4pt + hair))

// A case study. The headline number leads the result sentence; the bar beneath
// carries the same value, so the claim is legible before the prose is read.
#let workitem(w) = block(breakable: false, below: 0em, {
  grid(
    columns: (1fr, auto), column-gutter: 0.8em,
    text(font: serif, size: 10.4pt, weight: "semibold", w.title),
    text(font: sans, size: 7pt, fill: faint, tracking: TRACK, baseline: -0.5pt,
      upper(w.client + " · " + w.status)),
  )
  v(0.24em)
  {
    let stat = w.at("stat", default: none)
    if stat != none {
      text(font: display, size: 13.5pt, weight: "semibold", fill: accent, stat)
      h(0.3em)
    }
    text(font: serif, size: 9.4pt, weight: "semibold", fill: accent, w.result)
  }
  let m = w.at("meter", default: none)
  if m != none { v(0.3em); meter(m) }
  v(0.26em)
  text(size: 9pt, w.desc)
  v(0.2em)
  text(font: caption, size: 7.7pt, fill: faint, w.tech)
})

// A role in the experience list.
#let jobitem(j) = block(breakable: false, below: 0em, {
  grid(
    columns: (1fr, auto), column-gutter: 0.8em,
    text(font: serif, size: 10.2pt, weight: "semibold", j.role),
    text(font: sans, size: 7.6pt, fill: faint, baseline: -0.5pt, j.period),
  )
  v(0.1em)
  text(font: serif, size: 9pt, style: "italic", fill: muted, j.org + " · " + j.place)
  v(0.22em)
  text(size: 9pt, j.desc)
})

// Join items with hairlines: item, rule, item, rule, item …
#let joined(items, render) = {
  for (i, it) in items.enumerate() {
    if i > 0 { itemrule }
    render(it)
  }
}

// ── Masthead ─────────────────────────────────────────────────────────────────

#block(width: 100%, {
  text(font: display, size: 27pt, weight: "light", fill: ink, tracking: -0.5pt, D.name)
  v(0.4em)
  kicker(D.role, size: 8.4pt)
  linebreak()
  v(0.22em)
  kicker(D.discipline + " · " + D.location, size: 8pt, fill: muted, weight: "regular")
})

#v(0.85em)

#grid(
  columns: (1fr,) * D.contact.len(),
  column-gutter: 0.5cm,
  ..D.contact.map(c => {
    kicker(c.label, size: 6.4pt, fill: faint, weight: "regular")
    linebreak()
    v(0.3em)
    text(font: sans, size: 8.2pt, link(c.url, c.text))
  })
)

#v(0.9em)

#block(
  width: 100%, fill: wash, inset: (x: 0.75em, y: 0.6em), radius: 2pt,
  grid(
    columns: (auto, 1fr), column-gutter: 0.8em,
    align(horizon, kicker(L.status, size: 6.8pt, weight: "semibold")),
    align(horizon, text(font: serif, size: 9.2pt, D.availability)),
  ),
)

// ── Sections ─────────────────────────────────────────────────────────────────

#section(L.profile)[
  #text(size: 9.7pt, fill: ink, D.profile.lead)
  #v(0.45em)
  #text(size: 9pt, fill: muted, D.profile.body)
]

#section(D.edge.label)[
  #text(size: 9pt, D.edge.body)
]

#section(L.services)[
  #grid(
    columns: (1fr, 1fr), column-gutter: 0.85cm, row-gutter: 0.5em,
    ..D.services.map(s => {
      set par(justify: false, leading: 0.52em)
      text(font: sans, size: 8pt, weight: "semibold", fill: accent, s.name)
      linebreak()
      v(0.14em)
      text(size: 8.4pt, fill: muted, s.desc)
    })
  )
]

#section(L.work)[
  #text(font: caption, size: 8.2pt, style: "italic", fill: faint, D.work.note)
  #v(0.7em)
  #joined(D.work.items, workitem)
]

#section(L.engagement)[
  #deflist(D.engagement.map(e => (e.label, e.value)), labelw: 3.0cm)
]

#section(L.skills)[
  #deflist(D.skills.map(s => (s.category, s.items)), labelw: 3.2cm)
]

#section(L.experience)[
  #joined(D.experience, jobitem)
]

#section(L.education)[
  #joined(
    D.education.map(e => (role: e.degree, org: e.org, place: e.place, period: e.period, desc: e.desc)),
    jobitem,
  )
]

#section(L.languages)[
  #set par(justify: false)
  #for (i, l) in D.languages.enumerate() {
    if i > 0 { text(size: 9pt, fill: hair, "  ·  ") }
    text(font: sans, size: 8.1pt, weight: "medium", fill: accent, l.name)
    h(0.35em)
    text(size: 9pt, fill: muted, l.level)
  }
]
