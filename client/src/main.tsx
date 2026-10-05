import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './i18n';
import { isTv } from './lib/tv';
import { installProfileGuard } from './lib/profiles';

// Any API call can learn this device has to pick a profile; see lib/profiles.
installProfileGuard();

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );

// TV mode's code and styles are a separate download, fetched only inside the
// Android TV app, and in place before the first screen draws.
if (isTv) {
  import('./tv').then(m => m.startTvMode()).finally(render);
} else {
  render();
}
