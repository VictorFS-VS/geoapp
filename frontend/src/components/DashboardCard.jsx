// src/components/DashboardCard.jsx
import React from 'react';

function DashboardCard({ title, value, icon, bgColor }) {
  return (
    <div className={`d-flex align-items-center p-3 text-white rounded shadow-sm ${bgColor}`} style={{ minHeight: '100px' }}>
      <div className="me-3" style={{ fontSize: '2rem' }}>
        <i className={`bi ${icon}`}></i>
      </div>
      <div>
        <div style={{ fontWeight: 'bold', fontSize: '1.25rem' }}>{value}</div>
        <div>{title}</div>
      </div>
    </div>
  );
}

export default DashboardCard;
