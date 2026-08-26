export interface MenuItem {
  id: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
}

export interface AppMenu {
  id: string;
  label: string;
  items: MenuItem[];
}

export const appMenus: AppMenu[] = [
  {
    id: "file",
    label: "文件",
    items: [
      { id: "new", label: "新建" },
      { id: "open", label: "打开..." },
      { id: "save", label: "保存" },
      { id: "saveAs", label: "另存为..." },
      { id: "close", label: "关闭" },
      { id: "reset", label: "重置示例" },
      { id: "exit", label: "退出" },
    ],
  },
  {
    id: "edit",
    label: "编辑",
    items: [
      { id: "toggleMode", label: "源码模式" },
      { id: "clear", label: "清空" },
    ],
  },
  {
    id: "theme",
    label: "主题",
    items: [
      { id: "theme-system", label: "跟随系统" },
      { id: "theme-light", label: "亮色" },
      { id: "theme-dark", label: "暗色" },
    ],
  },
  {
    id: "paragraph",
    label: "段落",
    items: [
      { id: "paragraph", label: "段落（开发中）", disabled: true },
    ],
  },
  {
    id: "help",
    label: "帮助",
    items: [
      { id: "devtools", label: "打开开发者工具" },
      { id: "about", label: "关于 MarkNext" },
    ],
  },
];