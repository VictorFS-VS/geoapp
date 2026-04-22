// src/components/Modal.jsx
import React from 'react';
import { Modal as BsModal, Button } from 'react-bootstrap';

export default function Modal({ title = 'Modal', open, onClose, children }) {
  return (
    <BsModal show={open} onHide={onClose} centered backdrop="static">
      <BsModal.Header closeButton>
        <BsModal.Title>{title}</BsModal.Title>
      </BsModal.Header>
      <BsModal.Body>{children}</BsModal.Body>
    </BsModal>
  );
}
