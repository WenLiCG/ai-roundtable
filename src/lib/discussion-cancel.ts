const activeDiscussions = new Map<string, AbortController>();

export function registerDiscussionController(discussionId: string, controller: AbortController) {
  activeDiscussions.set(discussionId, controller);
}

export function unregisterDiscussionController(discussionId: string) {
  activeDiscussions.delete(discussionId);
}

export function cancelDiscussion(discussionId: string) {
  const controller = activeDiscussions.get(discussionId);

  if (!controller) {
    return false;
  }

  controller.abort("cancelled");
  activeDiscussions.delete(discussionId);
  return true;
}

