// src/components/UserDropdown.jsx
import React from 'react';
import { Dropdown } from 'react-bootstrap';
import { FaUserCircle } from 'react-icons/fa';

export default function UserDropdown({ usuario, onLogout }) {
  const formatFecha = (fecha) => {
    if (!fecha) return '---';
    const d = new Date(fecha);
    return d.toLocaleDateString('es-ES');
  };

  return (
    <Dropdown align="end">
      <Dropdown.Toggle
        variant="link"
        className="text-white border-0 d-flex align-items-center"
        style={{ fontSize: '1.25rem' }}
      >
        <FaUserCircle size={28} className="me-2" />
        <span className="d-none d-sm-inline">{usuario?.username || 'Usuario'}</span>
      </Dropdown.Toggle>

      <Dropdown.Menu>
        <Dropdown.Header className="text-center">
          <FaUserCircle size={48} className="mb-2" />
          <div className="fw-bold">{usuario?.username}</div>
          <small className="text-muted">
            Miembro desde {formatFecha(usuario?.fecha_creacion)}
          </small>
        </Dropdown.Header>
        <Dropdown.Divider />
        <Dropdown.Item href="/configuracion/usuarios">👤 Perfil</Dropdown.Item>
        <Dropdown.Item className="text-danger" onClick={onLogout}>
          🚪 Desconectarse
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
}
