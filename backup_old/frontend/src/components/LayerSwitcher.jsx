import React from 'react';
import {
    Box,
    List,
    ListItem,
    ListItemText,
    IconButton,
    Collapse,
    Slider,
    Switch,
    Typography,
    Paper
} from '@mui/material';
import { ExpandLess, ExpandMore } from '@mui/icons-material';

// Componente para un único item de capa
const LayerItem = ({ layer, onVisibilityChange, onOpacityChange }) => {
    const [open, setOpen] = React.useState(false);

    const handleVisibilityToggle = (event) => {
        onVisibilityChange(layer.id, event.target.checked);
    };

    const handleOpacityChange = (event, newValue) => {
        // El slider de MUI devuelve un valor de 0-100, lo convertimos a 0-1
        onOpacityChange(layer.id, newValue / 100);
    };

    return (
        <>
            <ListItem 
                secondaryAction={
                    <IconButton edge="end" onClick={() => setOpen(!open)}>
                        {open ? <ExpandLess /> : <ExpandMore />}
                    </IconButton>
                }
            >
                <Switch
                    edge="start"
                    checked={layer.visible}
                    onChange={handleVisibilityToggle}
                />
                <ListItemText primary={layer.name} />
            </ListItem>
            <Collapse in={open} timeout="auto" unmountOnExit>
                <Box sx={{ paddingLeft: 4, paddingRight: 3, paddingBottom: 2 }}>
                    <Typography gutterBottom variant="caption">Opacidad</Typography>
                    <Slider
                        value={layer.opacity * 100}
                        onChange={handleOpacityChange}
                        aria-labelledby="opacity-slider"
                        valueLabelDisplay="auto"
                        valueLabelFormat={value => `${value}%`}
                    />
                </Box>
            </Collapse>
        </>
    );
};


// Componente principal del panel de capas
const LayerSwitcher = ({ title, layers, onVisibilityChange, onOpacityChange }) => {
    if (!layers || layers.length === 0) {
        return null; // No mostrar nada si no hay capas
    }

    return (
        <Paper variant="outlined" sx={{ mt: 2 }}>
             <Typography variant="subtitle2" sx={{ padding: '12px 16px 0px' }}>
                {title}
            </Typography>
            <List dense>
                {layers.map(layer => (
                    <LayerItem
                        key={layer.id}
                        layer={layer}
                        onVisibilityChange={onVisibilityChange}
                        onOpacityChange={onOpacityChange}
                    />
                ))}
            </List>
        </Paper>
    );
};

export default LayerSwitcher;