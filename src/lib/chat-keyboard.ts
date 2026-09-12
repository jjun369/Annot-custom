export interface ChatKeyboardEventLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
}

/** Return true only for a plain, non-composing Enter that should submit a chat. */
export function shouldSubmitChatOnEnter(event: ChatKeyboardEventLike): boolean {
  if (
    event.key !== 'Enter'
    || event.shiftKey
    || event.ctrlKey
    || event.altKey
    || event.metaKey
    || event.repeat
  ) {
    return false;
  }

  const nativeEvent = event.nativeEvent;
  return !(
    event.isComposing
    || nativeEvent?.isComposing
    || event.keyCode === 229
    || event.which === 229
    || nativeEvent?.keyCode === 229
    || nativeEvent?.which === 229
  );
}
