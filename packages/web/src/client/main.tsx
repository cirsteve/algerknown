import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { ThemeProvider, ThemeToggle } from './context/ThemeContext';
import { initZkbPath } from './lib/api';

function render() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        {/*
          Floating until the app shell gains a header slot for it - the theme
          control has to be reachable from every route for the preference to be
          usable at all.
        */}
        <ThemeToggle className="fixed bottom-4 right-4 z-40 shadow-lg" />
      </ThemeProvider>
    </React.StrictMode>
  );
}

// Initialize ZKB path from server before rendering; a failure there must not
// leave the visitor staring at a blank page.
initZkbPath().catch(() => undefined).then(render);
