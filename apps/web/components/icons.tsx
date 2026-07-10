"use client";

import {
  Search, SearchAlt, Plus, TrashAlt, Save, Check, X, Cog, Filter, Pencil,
  Copy, RefreshCw, RefreshCcw, LoaderDots, DotsHorizontalRounded,
  ArrowBigUp, ArrowBigDown, ArrowBigLeft, ArrowBigRight, ArrowRight,
  ArrowUp, ArrowToBottom, ArrowToTop,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  File, FileCode, FileDetail, Folder, FolderPlus, Image, Video, Music, LinkAlt,
  Envelope, MessageBubbleCaptions, MessageBubbleCode, Send, Bell,
  User, Group, UserPlus, UserX,
  Box, Cuboid, Circle, RadioCircle, Square, Triangle,
  CheckCircle, AlertCircle, AlertTriangle, InfoCircle, XCircle,
  Layout, ListUl, CodeAlt, Terminal,
  GitBranch, GitCommit, GitMerge, Package, Database, Server,
  Play, Pause, StopCircle,
  Eye, EyeClosed, ExpandLeft, ShrinkLeft, SearchPlus, SearchMinus,
  Grid, Columns, Menu,
  Bold, Italic, Underline, Heading, FontColor, QuoteLeft, ListOl,
  Heart, Star, BookmarkAlt, Share, Lock, LockOpen, ShieldAlt2,
  Slider, SliderAlt, MagicWand, Bolt, Sun, Moon, Cloud,
  Timer, Calendar, MapIcon, Pin, Flag, TagAlt, Hashtag, At, Repeat,
  GlobeAlt, Compass, HomeAlt, Inbox, ArchiveAlt, History, TrendingUp,
  Layers, Move, Brain, FolderOpen, Flask, BarChart, Robot,
  DockRight, DockRightAlt,
  ChessKnight, WorkflowAlt, Cognition,
  type BoxIconProps,
} from "@boxicons/react";

export {
  IconRegistryProvider,
  useIconRegistry,
  iconRegistry
} from "./icon-registry";

import { useIconRegistry } from "./icon-registry";

const ICON_COMPONENTS: Record<string, React.ComponentType<BoxIconProps>> = {
  Search, SearchAlt, Plus, TrashAlt, Save, Check, X, Cog, Filter, Pencil,
  Copy, RefreshCw, RefreshCcw, LoaderDots, DotsHorizontalRounded,
  ArrowBigUp, ArrowBigDown, ArrowBigLeft, ArrowBigRight, ArrowRight, ArrowUp,
  ArrowToBottom, ArrowToTop,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  File, FileCode, FileDetail, Folder, FolderPlus, Image, Video, Music, LinkAlt,
  Envelope, MessageBubbleCaptions, MessageBubbleCode, Send, Bell,
  User, Group, UserPlus, UserX,
  Box, Cuboid, Circle, RadioCircle, Square, Triangle,
  CheckCircle, AlertCircle, AlertTriangle, InfoCircle, XCircle,
  Layout, ListUl, CodeAlt, Terminal,
  GitBranch, GitCommit, GitMerge, Package, Database, Server,
  Play, Pause, StopCircle,
  Eye, EyeClosed, ExpandLeft, ShrinkLeft, SearchPlus, SearchMinus,
  Grid, Columns, Menu,
  Bold, Italic, Underline, Heading, FontColor, QuoteLeft, ListOl,
  Heart, Star, BookmarkAlt, Share, Lock, LockOpen, ShieldAlt2,
  Slider, SliderAlt, MagicWand, Bolt, Sun, Moon, Cloud,
  Timer, Calendar, MapIcon, Pin, Flag, TagAlt, Hashtag, At, Repeat,
  GlobeAlt, Compass, HomeAlt, Inbox, ArchiveAlt, History, TrendingUp,
  Layers, Move, Brain, FolderOpen, Flask, BarChart, Robot,
  DockRight, DockRightAlt,
  ChessKnight, WorkflowAlt, Cognition,
};

function toBoxiconSize(size?: number | string): "xs" | "sm" | "base" | "md" | "lg" | "xl" {
  if (typeof size === "string") return "sm";
  if (!size || size <= 12) return "xs";
  if (size <= 16) return "sm";
  if (size <= 20) return "base";
  if (size <= 28) return "md";
  if (size <= 40) return "lg";
  return "xl";
}

export interface IconProps {
  name: string;
  size?: number | string;
  className?: string;
  [key: string]: unknown;
}

export function Icon({ name, size = 16, className, ...props }: IconProps) {
  const { icons } = useIconRegistry();
  const componentName = icons[name] || name;
  const Component = ICON_COMPONENTS[componentName];

  if (!Component) {
    return <span className={className} style={{ width: size, height: size, display: "inline-block" }} />;
  }

  const boxSize = toBoxiconSize(size);

  return <Component size={boxSize} className={className} {...props} />;
}
