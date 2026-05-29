/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */

import React, { useEffect, useState } from 'react';

import { classNames } from '../interfaceUtils';

interface Props {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: Props) {
  const [confirmHighlighted, setConfirmHighlighted] = useState(true);

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      switch (key) {
        case 'arrowleft':
        case 'arrowright':
        case 'a':
        case 'd':
          setConfirmHighlighted((h) => !h);
          break;
        case 'enter':
        case 'e':
          (confirmHighlighted ? onConfirm : onCancel)();
          break;
        case 'escape':
          onCancel();
          break;
        default:
          return;
      }

      // Capture phase + stop propagation keeps these keys from reaching the
      // save menu underneath.
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', onKeydown, true);

    return () => window.removeEventListener('keydown', onKeydown, true);
  }, [confirmHighlighted]);

  return (
    <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/50">
      <div className="w-[420px] bg-white text-black p-6 shadow-xl">
        <div className="text-lg mb-6 whitespace-pre-line">{message}</div>
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onMouseEnter={() => setConfirmHighlighted(true)}
            className={classNames(
              'px-5 py-2',
              confirmHighlighted ? 'bg-black text-white' : 'bg-gray-200',
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onMouseEnter={() => setConfirmHighlighted(false)}
            className={classNames(
              'px-5 py-2',
              !confirmHighlighted ? 'bg-black text-white' : 'bg-gray-200',
            )}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
