import type { PatentMetadata, ResearchDocument } from '@/types';

import { createLatestRequestGuard } from '@/lib/latest-request-guard';

export interface ResearchSelectionSnapshot {
  projectId: string;
  documentId: string;
  epoch: number;
}

export interface ResearchDocumentDraft {
  title: string;
  kind: ResearchDocument['kind'];
  patent: PatentMetadata | null;
}

export interface ResearchDraftState<Draft> {
  value: Draft;
  dirty: boolean;
}

interface RequestToken {
  id: number;
  key: string;
  selection: ResearchSelectionSnapshot;
}

function selectionKey(selection: ResearchSelectionSnapshot): string {
  return `${selection.projectId}\u0000${selection.documentId}\u0000${selection.epoch}`;
}

/**
 * Coordinates Research UI selection, async response ownership, and drafts.
 * The page uses this for both intentional selection and non-selecting refreshes.
 */
export function createResearchAsyncController<Draft>(areDraftsEqual: (left: Draft, right: Draft) => boolean) {
  let selection: ResearchSelectionSnapshot = { projectId: '', documentId: '', epoch: 0 };
  const bootstrapGuard = createLatestRequestGuard<string>();
  const detailGuard = createLatestRequestGuard<string>();
  const drafts = new Map<string, ResearchDraftState<Draft>>();
  const isCurrentSelection = (snapshot: ResearchSelectionSnapshot): boolean => selection.projectId === snapshot.projectId
    && selection.documentId === snapshot.documentId
    && selection.epoch === snapshot.epoch;

  return {
    currentSelection(): ResearchSelectionSnapshot {
      return { ...selection };
    },

    selectProject(projectId: string): ResearchSelectionSnapshot {
      selection = { projectId, documentId: '', epoch: selection.epoch + 1 };
      return { ...selection };
    },

    selectDocument(documentId: string): ResearchSelectionSnapshot {
      selection = { ...selection, documentId, epoch: selection.epoch + 1 };
      return { ...selection };
    },

    isCurrentSelection(snapshot: ResearchSelectionSnapshot): boolean {
      return isCurrentSelection(snapshot);
    },

    beginBootstrap(snapshot: ResearchSelectionSnapshot): RequestToken {
      const key = selectionKey(snapshot);
      return { id: bootstrapGuard.begin(key), key, selection: { ...snapshot } };
    },

    isCurrentBootstrap(token: RequestToken): boolean {
      return isCurrentSelection(token.selection) && bootstrapGuard.isCurrent(token.id, token.key);
    },

    beginDetail(snapshot: ResearchSelectionSnapshot): RequestToken {
      const key = selectionKey(snapshot);
      return { id: detailGuard.begin(key), key, selection: { ...snapshot } };
    },

    isCurrentDetail(token: RequestToken): boolean {
      return isCurrentSelection(token.selection) && detailGuard.isCurrent(token.id, token.key);
    },

    getDraft(documentId: string): ResearchDraftState<Draft> | undefined {
      const draft = drafts.get(documentId);
      return draft ? { value: draft.value, dirty: draft.dirty } : undefined;
    },

    updateDraft(documentId: string, value: Draft): void {
      drafts.set(documentId, { value, dirty: true });
    },

    applyServerDraft(documentId: string, value: Draft): ResearchDraftState<Draft> {
      const current = drafts.get(documentId);
      if (current?.dirty) return { value: current.value, dirty: true };
      const next = { value, dirty: false };
      drafts.set(documentId, next);
      return next;
    },

    markDraftSaved(documentId: string, value: Draft): void {
      const current = drafts.get(documentId);
      if (current && !areDraftsEqual(current.value, value)) return;
      drafts.set(documentId, { value, dirty: false });
    },
  };
}

export type ResearchAsyncController = ReturnType<typeof createResearchAsyncController<ResearchDocumentDraft>>;
