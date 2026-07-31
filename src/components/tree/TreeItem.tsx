'use client';

import { useEffect, useRef, useState } from 'react';
import { TreeNode } from '@/types';
import { useWorkspace } from '@/lib/workspace-store';
import { ChevronRight, Ellipsis, FileText, Folder, FolderInput, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { findNode, getParentFolderPath } from '@/lib/tree-utils';
import { TreePromptDialog } from './TreePromptDialog';
import { useFeedback } from '@/components/common/FeedbackProvider';

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
}

export function TreeItem({ node, depth, selectedPath }: TreeItemProps) {
  const { refreshTree, selectNode } = useWorkspace();
  const { confirm, notify } = useFeedback();
  const [expanded, setExpanded] = useState(depth < 1); // auto-expand first level
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isSelected = selectedPath === node.path;
  const isFolder = node.type === 'folder';
  const hasChildren = isFolder && (node.children?.length ?? 0) > 0;

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [menuOpen]);

  const handleClick = () => {
    if (isFolder) {
      setExpanded(!expanded);
    }
    selectNode(node);
  };

  const focusNodeByPath = async (nextPath: string | null) => {
    const nextTree = await refreshTree();
    if (!nextTree) return;

    if (!nextPath) {
      return;
    }

    const nextNode = findNode(nextTree, nextPath);
    if (nextNode) {
      selectNode(nextNode);
    }
  };

  const handleRename = async (nextName: string) => {
    setIsMutating(true);
    try {
      const endpoint = node.type === 'folder' ? '/api/workspace/folders' : '/api/papers';
      const payload = node.type === 'folder'
        ? { path: node.path, name: nextName }
        : { path: node.path, name: nextName, action: 'rename' };

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '이름을 바꾸지 못했습니다.');
      }

      setMenuOpen(false);
      setRenameDialogOpen(false);
      await focusNodeByPath(data.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : '이름을 바꾸지 못했습니다.';
      notify(message, 'error');
    } finally {
      setIsMutating(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: '휴지통으로 이동',
      message: `${node.name}을(를) 휴지통으로 옮길까요?`,
      confirmLabel: '휴지통으로 이동',
    });
    if (!confirmed) return;

    setIsMutating(true);
    try {
      const endpoint = node.type === 'folder'
        ? `/api/workspace/folders?path=${encodeURIComponent(node.path)}`
        : `/api/papers?path=${encodeURIComponent(node.path)}`;

      const res = await fetch(endpoint, { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '삭제하지 못했습니다.');
      }

      setMenuOpen(false);
      await focusNodeByPath(getParentFolderPath(node) || null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '삭제하지 못했습니다.';
      notify(message, 'error');
    } finally {
      setIsMutating(false);
    }
  };

  const handleMovePdf = async (targetFolderPath: string) => {
    if (node.type !== 'pdf') return;
    setIsMutating(true);
    try {
      const res = await fetch('/api/papers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: node.path,
          targetFolderPath,
          action: 'move',
        }),
      });
      const data = await res.json();

      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'PDF를 이동하지 못했습니다.');
      }

      setMenuOpen(false);
      setMoveDialogOpen(false);
      await focusNodeByPath(data.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF를 이동하지 못했습니다.';
      notify(message, 'error');
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div>
      <div
        className={`
          group relative flex items-center rounded-lg transition-colors
          ${isSelected
            ? 'bg-surface-container-lowest text-on-surface shadow-sm'
            : 'text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface'
          }
        `}
      >
        <button
          onClick={handleClick}
          className="flex min-w-0 flex-1 items-center gap-1 py-1.5 text-left"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {isFolder && hasChildren && (
              <ChevronRight
                size={12}
                strokeWidth={2}
                className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
            )}
          </span>

          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {isFolder ? (
              expanded ? (
                <FolderOpen size={14} strokeWidth={1.8} className="text-tertiary-fixed" />
              ) : (
                <Folder size={14} strokeWidth={1.8} className="text-on-surface-variant" />
              )
            ) : (
              <FileText size={13} strokeWidth={1.8} className="text-outline" />
            )}
          </span>

          <span className={`text-xs truncate ${isFolder ? 'font-medium' : 'font-normal'}`}>
            {node.name}
          </span>
        </button>

        <div ref={menuRef} className="relative mr-1 shrink-0">
          <button
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((current) => !current);
            }}
            disabled={isMutating}
            className={`
              h-6 w-6 items-center justify-center rounded transition-colors
              ${menuOpen ? 'flex bg-surface-container-high text-on-surface' : 'hidden group-hover:flex text-on-surface-variant hover:bg-surface-container-high'}
              disabled:opacity-50
            `}
            title="More actions"
          >
            <Ellipsis size={13} strokeWidth={2} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-7 z-20 min-w-36 rounded-lg border border-outline-variant/20 bg-surface-container-lowest py-1 shadow-ambient">
              {node.type === 'pdf' && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setMoveDialogOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container-high"
                >
                  <FolderInput size={12} strokeWidth={2} />
                  이동
                </button>
              )}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRenameDialogOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container-high"
              >
                <Pencil size={12} strokeWidth={2} />
                이름 바꾸기
              </button>
              <button
                onClick={() => void handleDelete()}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-error hover:bg-surface-container-high"
              >
                <Trash2 size={12} strokeWidth={2} />
                휴지통
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Children */}
      {isFolder && expanded && node.children?.map((child) => (
        <TreeItem
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
        />
      ))}

      {renameDialogOpen && (
        <TreePromptDialog
          open
          title={node.type === 'pdf' ? 'PDF 이름 바꾸기' : '폴더 이름 바꾸기'}
          description={node.type === 'pdf'
            ? '표시되는 PDF 파일 이름을 바꿉니다.'
            : '폴더 이름을 바꿉니다.'}
          initialValue={node.type === 'pdf' ? node.name.replace(/\.pdf$/i, '') : node.name}
          placeholder={node.type === 'pdf' ? 'PDF 이름' : '폴더 이름'}
          confirmLabel="이름 바꾸기"
          busy={isMutating}
          onCancel={() => setRenameDialogOpen(false)}
          onConfirm={(value) => handleRename(value)}
        />
      )}

      {node.type === 'pdf' && moveDialogOpen && (
        <TreePromptDialog
          open
          title="PDF 이동"
          description="라이브러리 기준 폴더 경로를 입력하세요. 비워두면 최상위로 이동합니다."
          initialValue={getParentFolderPath(node)}
          placeholder="대상 폴더 경로"
          confirmLabel="이동"
          allowEmpty
          busy={isMutating}
          onCancel={() => setMoveDialogOpen(false)}
          onConfirm={(value) => handleMovePdf(value)}
        />
      )}
    </div>
  );
}
