import './style.css';

// Phase 0.1 placeholder entry point. The Game bootstrap, renderer and loop arrive in Phase 0.3.
const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <main class="boot">
      <h1 class="boot__title">THE LAST SIGNAL</h1>
      <p class="boot__status">Phase 0 — foundation</p>
    </main>
  `;
}
