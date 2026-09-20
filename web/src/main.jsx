import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { DepartmentProvider } from './context/DepartmentContext.jsx';
import App from './App.jsx';
import './styles/index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <DepartmentProvider>
            <App />
          </DepartmentProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
