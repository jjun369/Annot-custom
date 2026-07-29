'use client';

import { TreeItem } from './TreeItem';
import { TreePromptDialog } from './TreePromptDialog';
import { useWorkspace } from '@/lib/workspace-store';
import { FolderPlus, FilePlus, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { countItems, findNode, getParentFolderPath } from '@/lib/tree-utils';
import { useFeedback } from '@/components/common/FeedbackProvider';
import { useRef, useState } from 'react';
import { TreeNode } from '@/types';

export function TreeExplorer() {
  const {
    treeRoot,
    treeLoading,
    selectedNode,
    selectNode,
    clearSelection,
    refreshTree,
    explorerOpen,
    toggleExplorer,
  } = useWorkspace();
  const { notify } = useFeedback();
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const targetFolderPath = getParentFolderPath(selectedNode);
  const stats = treeRoot ? countItems(treeRoot) : { folders: 0, pdfs: 0 };

  const handleCreateFolder = async (name: string) => {
    setIsCreatingFolder(true);
    try {
      const res = await fetch('/api/workspace/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: targetFolderPath,
          name: name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(typeof data?.error === 'string' ? data.error : '폴더를 만들지 못했습니다.');
      }

      const nextTree = await refreshTree();
      if (nextTree) {
        const nextNode = findNode(nextTree, data.path);
        if (nextNode) {
          selectNode(nextNode);
        }
      }
      setCreateDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '폴더를 만들지 못했습니다.';
      notify(message, 'error');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    setIsUploading(true);
    try {
      let lastImported: TreeNode | null = null;
      let duplicateCount = 0;
      for (const file of files) {
        const formData = new FormData();
        formData.set('file', file);
        formData.set('folderPath', targetFolderPath);

        const res = await fetch('/api/papers', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok || data?.error) {
          throw new Error(typeof data?.error === 'string' ? data.error : `${file.name}을 추가하지 못했습니다.`);
        }
        if (data.duplicate) duplicateCount += 1;
        lastImported = data as TreeNode;
      }

      const nextTree = await refreshTree();
      if (nextTree && lastImported) {
        const nextNode = findNode(nextTree, lastImported.path);
        if (nextNode) {
          selectNode(nextNode);
        }
      }
      const importedCount = files.length - duplicateCount;
      notify(
        duplicateCount > 0
          ? `PDF ${importedCount}개를 라이브러리에 복사했고, 중복 ${duplicateCount}개는 기존 파일을 열었습니다.`
          : `PDF ${importedCount}개를 PageDock Library에 복사했습니다.`,
        'success',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF를 추가하지 못했습니다.';
      notify(message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  if (!explorerOpen) {
    return (
      <aside className="w-12 bg-surface-container flex flex-col shrink-0 overflow-hidden border-r border-outline-variant/10">
        <div className="h-10 flex items-center justify-center shrink-0">
          <button
            onClick={toggleExplorer}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="탐색기 펼치기"
          >
            <PanelLeftOpen size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-[10px] text-outline [writing-mode:vertical-rl] rotate-180">
            탐색기
          </div>
        </div>

        <div className="px-1 py-3 shrink-0 text-center text-[10px] text-outline leading-tight">
          <div>{stats.folders}F</div>
          <div>{stats.pdfs}P</div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(event) => void handleUploadChange(event)}
        />
      </aside>
    );
  }

  return (
    <aside className="w-[240px] bg-surface-container flex flex-col shrink-0 overflow-hidden border-r border-outline-variant/10">
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={toggleExplorer}
            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors"
            title="탐색기 접기"
          >
            <PanelLeftClose size={13} strokeWidth={2} />
          </button>
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            탐색기
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setCreateDialogOpen(true)}
            disabled={isCreatingFolder || treeLoading}
            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
            title="폴더 만들기"
          >
            <FolderPlus size={13} strokeWidth={2} />
          </button>
          <button
            onClick={handleUploadClick}
            disabled={isUploading || treeLoading}
            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50"
            title="PDF 추가"
          >
            <FilePlus size={13} strokeWidth={2} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(event) => void handleUploadChange(event)}
          />
        </div>
      </div>

      {/* Tree */}
      <nav
        className="flex-1 overflow-y-auto px-1 pb-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            clearSelection();
          }
        }}
      >
        {treeLoading ? (
          <div className="px-3 py-2 text-xs text-on-surface-variant">라이브러리를 불러오는 중...</div>
        ) : treeRoot?.children?.length ? (
          treeRoot.children.map((node) => (
            <TreeItem
              key={node.id}
              node={node}
              depth={0}
              selectedPath={selectedNode?.path ?? null}
            />
          ))
        ) : (
          <div className="px-3 py-2 text-xs text-on-surface-variant">
            아직 폴더나 PDF가 없습니다.
          </div>
        )}
      </nav>

      {/* Footer stats */}
      <div className="px-3 py-2 shrink-0">
        <div className="text-[10px] text-outline">
          폴더 {stats.folders}개 &middot; PDF {stats.pdfs}개
        </div>
      </div>

      {createDialogOpen && (
        <TreePromptDialog
          open
          title="폴더 만들기"
          description={targetFolderPath
            ? `${targetFolderPath} 안에 새 폴더를 만듭니다.`
            : '라이브러리 최상위에 새 폴더를 만듭니다.'}
          placeholder="폴더 이름"
          confirmLabel="만들기"
          busy={isCreatingFolder}
          onCancel={() => setCreateDialogOpen(false)}
          onConfirm={(value) => handleCreateFolder(value)}
        />
      )}
    </aside>
  );
}
