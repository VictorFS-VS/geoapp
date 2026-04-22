import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label
} from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const GraficoTramosPorProyecto = () => {
  const [datos, setDatos] = useState([]);

  useEffect(() => {
    axios
      .get(`${API_URL}/dashboard/tramos-por-proyecto`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      })
      .then(res => {
        setDatos(res.data);
      })
      .catch(err => {
        console.error('Error al cargar datos del gráfico:', err);
      });
  }, []);

  return (
    <div className="w-full h-[400px] bg-white shadow rounded p-4">
      <h3 className="text-lg font-semibold mb-4">Tramos por Proyecto</h3>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 20, right: 30, left: 0, bottom: 80 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="nombre" angle={-45} textAnchor="end" interval={0}>
            <Label value="Proyectos" offset={-70} position="insideBottom" />
          </XAxis>
          <YAxis>
            <Label value="Cantidad de Tramos" angle={-90} position="insideLeft" />
          </YAxis>
          <Tooltip />
          <Bar dataKey="cantidad_tramos" fill="#8884d8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default GraficoTramosPorProyecto;
