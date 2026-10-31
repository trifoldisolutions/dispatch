// htm bound to Preact: components here are written as html`<div>…</div>`
// tagged templates, so the browser runs them as they are, with no build step.
import { h } from "preact";
import htm from "htm";

export const html = htm.bind(h);
