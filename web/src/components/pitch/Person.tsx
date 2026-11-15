import { Fn } from './sources';

/**
 * One real person and what the blackout did to him. Source: Yale E360, Phiri & Clayton, Nov 21, 2024
 * (fact-checked word for word by nasa-manager; see patronus-pitch/people/PERSON-STORY.md). Text only, no photo.
 */
export function Person() {
  return (
    <section className="pt-person" aria-labelledby="pt-person-h">
      <div className="wrap pt-person-grid">
        <div className="pt-person-who">
          <p className="eyebrow">Lusaka, Zambia, 2024</p>
          <h2 id="pt-person-h" className="pt-person-name">Emmanuel Simukoko</h2>
          <p className="pt-person-role">Runs a small grocery and drinks shop in Kabwata, Lusaka.</p>
        </div>
        <div className="pt-person-story">
          <p className="pt-person-fact">
            Zambia’s load-shedding began on March 11, 2024,<Fn k="lusakatimes" /> and his power went out for up to 21 hours a day. With no power he could not sell cold drinks, his biggest earner, and could not charge his phone to take mobile payments. He lost about <span className="pt-num pt-person-n">30%</span> of his business.<Fn k="e360" />
          </p>
          <blockquote className="pt-person-q">
            <p>“When the lights are off, people think that my shop is closed.”</p>
            <footer>Emmanuel Simukoko, to Yale Environment 360<Fn k="e360" /></footer>
          </blockquote>
          <p className="pt-person-link">
            With months of warning, shops like his could have had a schedule to plan around and solar in place before the dry season.
          </p>
        </div>
      </div>
    </section>
  );
}
