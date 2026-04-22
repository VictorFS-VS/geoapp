// src/components/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom';
import { getUser } from '@/utils/auth';

export default function ProtectedRoute({ children, roles }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;

  if (roles && roles.length) {
    const user = getUser();
    const tipo = Number(user?.tipo_usuario);
    if (!roles.includes(tipo)) {
      // si no está autorizado, al inicio
      return <Navigate to="/" replace />;
    }
  }
  return children;
}
