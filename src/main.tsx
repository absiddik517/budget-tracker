import { createRoot, type Root } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('root')!;
const containerWithRoot = container as HTMLElement & { __reactAppRoot?: Root };
const root = containerWithRoot.__reactAppRoot ?? createRoot(container);
containerWithRoot.__reactAppRoot = root;
root.render(<App />);
