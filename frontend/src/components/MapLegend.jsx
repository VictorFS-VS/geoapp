import React from 'react';
import { Box, Paper, Typography } from '@mui/material';

// Subcomponente para cada elemento de la leyenda
const LegendItem = ({ color, label }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
    <Box 
      sx={{ 
        width: 15, 
        height: 15, 
        backgroundColor: color,
        border: '1px solid #555',
        mr: 1 
      }} 
    />
    <Typography variant="caption">{label}</Typography>
  </Box>
);

// Componente principal de la leyenda
const MapLegend = ({ title, items }) => {
  // No renderizar nada si no hay elementos que mostrar
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <Paper 
      elevation={3}
      sx={{
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        zIndex: 1000,
        padding: '8px 12px',
        backgroundColor: 'rgba(255, 255, 255, 0.85)', // Fondo semitransparente
        backdropFilter: 'blur(4px)', // Efecto de desenfoque para legibilidad
        borderRadius: '8px',
      }}
    >
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      {items.map((item, index) => (
        <LegendItem key={index} color={item.color} label={item.label} />
      ))}
    </Paper>
  );
};

export default MapLegend;