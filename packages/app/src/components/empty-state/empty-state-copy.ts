import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { isBbEditorHost } from '@/lib/bb-editor-host';

export function getEmptyStateCopy({
  isOnboarding,
  isEmbedded,
}: {
  isOnboarding: boolean;
  isEmbedded: boolean;
}): { title: MessageDescriptor; subtitle: MessageDescriptor } {
  if (isBbEditorHost()) {
    return {
      title: msg`Create something great.`,
      subtitle: msg`Start a blank file, or scaffold from a template.`,
    };
  }
  if (isOnboarding) {
    return {
      title: msg`What would you like to create?`,
      subtitle: isEmbedded
        ? msg`Copy a prompt and paste it into your agent to set up your project.`
        : msg`Describe what you're working on and the agent sets it up for you.`,
    };
  }
  return {
    title: msg`Create something great.`,
    subtitle: isEmbedded
      ? msg`Copy a prompt for your agent, start a blank file, or scaffold from a template.`
      : msg`Describe what you want to build, start a blank file, or scaffold from a template.`,
  };
}
