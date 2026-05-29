/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/interactive-supports-focus */

import React, { useEffect, useState } from 'react';

import {
  SAVE_SLOT_COUNT,
  SlotSummary,
  getSlotSummaries,
  saveToSlot,
  loadFromSlot,
  deleteSlot,
} from '../../state/save';
import updateInterface from '../../state/updateInterface';
import { classNames } from '../interfaceUtils';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  onClose: () => void;
}

export default function SaveMenu({ onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [summaries, setSummaries] = useState<SlotSummary[]>(getSlotSummaries);
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const refresh = () => setSummaries(getSlotSummaries());

  const ask = (message: string, onConfirm: () => void) =>
    setConfirm({ message, onConfirm });

  const performSave = (index: number) => {
    if (saveToSlot(index)) {
      refresh();
      updateInterface.toast(`已保存到记录 ${index + 1}`);
    } else {
      updateInterface.toast('保存失败');
    }
  };

  const doSave = (index: number) => {
    if (summaries[index].empty) {
      performSave(index);
    } else {
      ask(`覆盖记录 ${index + 1}？`, () => performSave(index));
    }
  };

  const doLoad = (index: number) => {
    if (summaries[index].empty) {
      return;
    }

    ask(`加载记录 ${index + 1}？\n当前未保存的进度将丢失。`, () => {
      if (loadFromSlot(index)) {
        updateInterface.toast(`已加载记录 ${index + 1}`);
        onClose();
      }
    });
  };

  const doDelete = (index: number) => {
    if (summaries[index].empty) {
      return;
    }

    ask(`删除记录 ${index + 1}？`, () => {
      deleteSlot(index);
      refresh();
    });
  };

  const doRestart = () => {
    ask('重新开始游戏？\n当前未保存的进度将丢失。', () =>
      window.location.reload(),
    );
  };

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      // While a confirmation is open, let ConfirmDialog handle keys.
      if (confirm) {
        return;
      }

      const key = e.key.toLowerCase();

      switch (key) {
        case 'arrowup':
        case 'w':
          setActiveIndex((i) => (i - 1 + SAVE_SLOT_COUNT) % SAVE_SLOT_COUNT);
          break;
        case 'arrowdown':
        case 's':
          setActiveIndex((i) => (i + 1) % SAVE_SLOT_COUNT);
          break;
        case 'l':
        case 'enter':
        case 'e':
          doLoad(activeIndex);
          break;
        case 'delete':
        case 'backspace':
          doDelete(activeIndex);
          break;
        case 'r':
          doRestart();
          break;
        case 'escape':
        case 'f3':
          onClose();
          break;
        default:
          return;
      }

      // Stop handled keys from reaching the game's input handler.
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', onKeydown, true);

    return () => window.removeEventListener('keydown', onKeydown, true);
  }, [activeIndex, summaries, confirm]);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="w-[640px] bg-white text-black p-6 shadow-xl">
        <div className="text-2xl font-bold mb-1">存档 / 读档</div>
        <div className="text-sm text-gray-500 mb-4">
          ↑↓ 选择 · S 保存 · L/回车 加载 · Del 删除 · R 重新开始 · Esc 关闭
        </div>

        <div className="mb-4">
          {summaries.map((slot) => {
            const selected = slot.index === activeIndex;

            return (
              <div
                key={slot.index}
                className={classNames(
                  'flex items-center px-3 py-2 cursor-pointer',
                  selected ? 'bg-black text-white' : 'text-black',
                )}
                onClick={() => setActiveIndex(slot.index)}
                onDoubleClick={() =>
                  slot.empty ? doSave(slot.index) : doLoad(slot.index)
                }
                role="button"
              >
                <div className="w-10 text-lg font-bold">{slot.index + 1}</div>
                {slot.empty ? (
                  <div className="flex-1 italic opacity-60">— 空 Empty —</div>
                ) : (
                  <div className="flex-1 flex justify-between">
                    <span className="font-semibold">{slot.location}</span>
                    <span>{slot.inGameDate}</span>
                    <span className="opacity-60 text-sm self-center">
                      {slot.savedAt}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between">
          <div className="space-x-2">
            <button
              type="button"
              className="px-4 py-2 bg-gray-800 text-white"
              onClick={() => doSave(activeIndex)}
            >
              保存
            </button>
            <button
              type="button"
              className="px-4 py-2 bg-gray-800 text-white disabled:opacity-40"
              disabled={summaries[activeIndex].empty}
              onClick={() => doLoad(activeIndex)}
            >
              加载
            </button>
            <button
              type="button"
              className="px-4 py-2 bg-gray-800 text-white disabled:opacity-40"
              disabled={summaries[activeIndex].empty}
              onClick={() => doDelete(activeIndex)}
            >
              删除
            </button>
          </div>
          <div className="space-x-2">
            <button
              type="button"
              className="px-4 py-2 bg-red-700 text-white"
              onClick={doRestart}
            >
              重新开始
            </button>
            <button
              type="button"
              className="px-4 py-2 bg-gray-300 text-black"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={() => {
            const { onConfirm } = confirm;
            setConfirm(null);
            onConfirm();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
