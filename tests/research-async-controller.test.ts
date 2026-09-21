import { describe, expect, test } from 'vitest';

import { createResearchAsyncController, type ResearchDocumentDraft } from '@/lib/research-async-controller';

const draft = (title: string): ResearchDocumentDraft => ({
  title,
  kind: 'paper',
  patent: null,
});

function createController() {
  return createResearchAsyncController<ResearchDocumentDraft>((left, right) => JSON.stringify(left) === JSON.stringify(right));
}

describe('Research async orchestration', () => {
  test('preserves a dirty document draft when deferred polling returns newer server detail', async () => {
    const controller = createController();
    const selection = controller.selectDocument('document-a');
    controller.applyServerDraft('document-a', draft('Server title'));
    controller.updateDraft('document-a', draft('Unsaved title'));

    let resolvePoll!: (value: string) => void;
    const deferredPoll = new Promise<string>((resolve) => { resolvePoll = resolve; });
    const pollRequest = controller.beginDetail(selection);
    const committedDraft = deferredPoll.then((serverTitle) => {
      if (!controller.isCurrentDetail(pollRequest)) return undefined;
      return controller.applyServerDraft('document-a', draft(serverTitle));
    });
    resolvePoll('Server refresh after analysis progress');
    await deferredPoll;

    expect(controller.isCurrentDetail(pollRequest)).toBe(true);
    await expect(committedDraft).resolves.toEqual({
      value: draft('Unsaved title'),
      dirty: true,
    });
  });

  test('does not let a deferred save completion select document A after switching to B', async () => {
    const controller = createController();
    const selectionA = controller.selectDocument('document-a');
    let resolveSave!: () => void;
    const deferredSave = new Promise<void>((resolve) => { resolveSave = resolve; });
    let selectedByLateSave = false;
    const saveCompletion = deferredSave.then(() => {
      if (controller.isCurrentSelection(selectionA)) selectedByLateSave = true;
    });

    controller.selectDocument('document-b');
    controller.selectDocument('document-a');
    resolveSave();
    await saveCompletion;

    expect(controller.isCurrentSelection(selectionA)).toBe(false);
    expect(selectedByLateSave).toBe(false);
    expect(controller.currentSelection().documentId).toBe('document-a');
  });

  test('stops a deferred old-project poll before it can publish or start a refresh', async () => {
    const controller = createController();
    const selectionA = controller.selectProject('project-a');
    const oldPoll = controller.beginBootstrap(selectionA);
    let resolvePoll!: () => void;
    const deferredPoll = new Promise<void>((resolve) => { resolvePoll = resolve; });

    const selectionB = controller.selectProject('project-b');
    resolvePoll();
    await deferredPoll;

    expect(controller.isCurrentBootstrap(oldPoll)).toBe(false);
    expect(controller.currentSelection()).toEqual(selectionB);
  });

  test('refreshes the current project instead of selecting all after delayed deletion of A', async () => {
    const controller = createController();
    const selectionA = controller.selectProject('project-a');
    let resolveDelete!: () => void;
    const deferredDelete = new Promise<void>((resolve) => { resolveDelete = resolve; });

    const selectionB = controller.selectProject('project-b');
    resolveDelete();
    await deferredDelete;

    const shouldSelectAll = controller.isCurrentSelection(selectionA);
    expect(shouldSelectAll).toBe(false);
    expect(controller.currentSelection()).toEqual(selectionB);
    expect(controller.currentSelection().projectId).toBe('project-b');
  });
});
