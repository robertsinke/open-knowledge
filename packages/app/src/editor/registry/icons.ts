import type { LucideIcon } from 'lucide-react';
import {
  AlignCenter,
  AppWindow,
  Box,
  ChevronRight,
  CopyPlus,
  FileText,
  Film,
  GitBranch,
  Image,
  LayoutPanelTop,
  MessageSquareWarning,
  PanelTop,
  Paperclip,
  PenTool,
  Sigma,
  SquarePlay,
  Volume2,
  Workflow,
  ZoomIn,
} from '@/lib/host-icons';

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  AlignCenter,
  AppWindow,
  ChevronRight,
  CopyPlus,
  FileText,
  Film,
  GitBranch,
  Image,
  LayoutPanelTop,
  MessageSquareWarning,
  PanelTop,
  Paperclip,
  PenTool,
  Sigma,
  SquarePlay,
  Volume2,
  Workflow,
  ZoomIn,
};

export function hasIconMapping(iconName: string): boolean {
  return Object.hasOwn(ICON_COMPONENTS, iconName);
}

export function resolveIcon(iconName: string | undefined): LucideIcon {
  if (!iconName) return Box;
  return Object.hasOwn(ICON_COMPONENTS, iconName) ? ICON_COMPONENTS[iconName] : Box;
}
