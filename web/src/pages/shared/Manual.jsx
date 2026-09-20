import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Button, Card, PageHeader } from '../../components/ui.jsx';
import { ROLE_LABEL } from '../../nav.js';
import { LANGUAGES, MANUALS } from '../../manual/content.js';
import { Figure } from '../../manual/figures.jsx';
import '../../styles/manual.css';

import { readChoice, writeSetting } from '../../lib/storage.js';
/**
 * The in-portal user manual.
 *
 * One route, six manuals: the signed-in user's role selects which handbook
 * they read, so each portal shows its own instructions and nobody has to be
 * told which document applies to them. Every string exists in English and
 * Kannada and the reader chooses to see one or both — the language toggle
 * only changes CSS visibility, so printing and in-page search still find
 * the text of the other language.
 */
export function Manual() {
  const { role } = useAuth();
  // A pupil's account no longer signs in, so the family manual is the parent's.
  const manual = MANUALS[role] || MANUALS.PARENT;

  const [lang, setLang] = useState(() => readChoice('vignan.manual.lang', LANGUAGES.map((l) => l.id), 'both'));
  const [active, setActive] = useState(manual.chapters[0]?.id);
  const bodyRef = useRef(null);

  useEffect(() => writeSetting('vignan.manual.lang', lang), [lang]);

  // Highlight the chapter currently under the reader's eye.
  useEffect(() => {
    const nodes = manual.chapters
      .map((chapter) => document.getElementById(`ch-${chapter.id}`))
      .filter(Boolean);
    if (!nodes.length || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id.replace('ch-', ''));
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [manual]);

  const jump = (id) => document.getElementById(`ch-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const chapters = useMemo(() => manual.chapters, [manual]);

  return (
    <div className={`stack lang-${lang}`}>
      <PageHeader
        title={`${ROLE_LABEL[role] || manual.role.en} Manual`}
        subtitle={`${manual.subtitle.en} · ${manual.subtitle.kn}`}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <div className="manual-lang no-print" role="group" aria-label="Language">
              {LANGUAGES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={option.id === lang ? 'on' : ''}
                  onClick={() => setLang(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button variant="secondary" icon="printer" onClick={() => window.print()} className="no-print">
              Print
            </Button>
          </div>
        }
      />

      <Card>
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <span className="stat-icon tone-gold" style={{ width: 42, height: 42, flexShrink: 0 }}>
            <Icon name="book-open" size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <p className="en-only">{manual.intro.en}</p>
            <p className="kn-p text-muted" style={{ marginTop: 6 }}>
              {manual.intro.kn}
            </p>
          </div>
        </div>
      </Card>

      <div className="manual" ref={bodyRef}>
        <nav className="manual-toc no-print" aria-label="Contents">
          <h4>Contents · ಪರಿವಿಡಿ</h4>
          {chapters.map((chapter, i) => (
            <button
              key={chapter.id}
              type="button"
              className={chapter.id === active ? 'on' : ''}
              onClick={() => jump(chapter.id)}
            >
              <span className="num">{i + 1}</span>
              <span style={{ minWidth: 0 }}>
                <span className="en-only">{chapter.title.en}</span>
                <span className="kn">{chapter.title.kn}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="manual-body">
          {chapters.map((chapter, i) => (
            <Card key={chapter.id} className="chapter">
              <div id={`ch-${chapter.id}`} className="chapter-head">
                <span className="n">{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <h2>{chapter.title.en}</h2>
                  <div className="kn-title">{chapter.title.kn}</div>
                  <p>{chapter.summary.en}</p>
                  <p className="kn-p">{chapter.summary.kn}</p>
                </div>
              </div>

              {chapter.topics.map((topic) => (
                <section className="topic" key={topic.title.en}>
                  <h3>{topic.title.en}</h3>
                  <div className="kn-title">{topic.title.kn}</div>

                  <div className="topic-grid">
                    <figure className="fig-wrap" style={{ margin: 0 }}>
                      <Figure name={topic.figure} />
                      <figcaption className="cap">
                        <span className="en-only">{topic.caption.en}</span>
                        <span className="kn">{topic.caption.kn}</span>
                      </figcaption>
                    </figure>

                    <div>
                      <ol className="steps" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {topic.steps.map((step, n) => (
                          <li className="step" key={step.en}>
                            <span className="n">{n + 1}</span>
                            <span className="txt">
                              <span className="en">{step.en}</span>
                              <span className="kn">{step.kn}</span>
                            </span>
                          </li>
                        ))}
                      </ol>

                      {(topic.notes || []).map((note) => (
                        <div className={`note ${note.tone}`} key={note.title.en}>
                          <span className="ico">
                            <Icon
                              name={
                                note.tone === 'tip'
                                  ? 'check-circle'
                                  : note.tone === 'warn'
                                    ? 'alert-triangle'
                                    : note.tone === 'rule'
                                      ? 'shield-check'
                                      : 'info'
                              }
                              size={16}
                            />
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <strong className="en-only">{note.title.en}</strong>
                            <strong className="kn">{note.title.kn}</strong>
                            <span className="en">{note.body.en}</span>
                            <span className="kn">{note.body.kn}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ))}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Manual;
