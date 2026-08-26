import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { ThemeProvider } from './context/ThemeContext';
import { initZkbPath } from './lib/api';

function render() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        {/*
          The theme control now lives in the app shell itself - the desktop
          sidebar footer and the mobile header/drawer - so it is reachable from
          every route without a floating control sitting on top of page content.
        */}
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </React.StrictMode>
  );
}

// Initialize ZKB path from server before rendering; a failure there must not
// leave the visitor staring at a blank page, but it does need to be diagnosable.
initZkbPath()
  .catch((error) => {
    console.error('Failed to initialize ZKB path from server', error);
  })
  .then(render);
