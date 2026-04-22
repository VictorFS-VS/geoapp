// src/components/AvatarCircle.jsx
import React, { useState, useEffect } from 'react';
import { FaUserCircle } from 'react-icons/fa';

export default function AvatarCircle({
  src,
  size = 32,
  className = '',
  onError, // opcional
}) {
  const [broken, setBroken] = useState(false);

  // Si cambia src, reintenta mostrar la imagen
  useEffect(() => { setBroken(false); }, [src]);

  const showImg = src && !broken;
  const pad = size >= 64 ? 6 : size >= 48 ? 4 : 3;

  return (
    <div
      className={`circle-avatar ${className}`}
      data-hasimg={showImg ? '1' : '0'}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        background: '#fff',                  // fondo blanco para logos con transparencia
        display: 'grid',
        placeItems: 'center',
        boxShadow: '0 0 0 1px rgba(0,0,0,.12)',
        flexShrink: 0,
        padding: pad                          // respiro para que no se corte
      }}
    >
      {showImg ? (
        <img
          src={src}
          alt="avatar"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',             // clave para logos anchos
            objectPosition: 'center',
            display: 'block'
          }}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => { setBroken(true); onError && onError(); }}
        />
      ) : (
        <FaUserCircle size={Math.max(20, Math.floor(size * 0.7))} />
      )}
    </div>
  );
}
