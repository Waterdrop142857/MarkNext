// New UI labels currently adapted for the app's two supported languages.
// Other standalone Muya locales fall back to English for these keys.
export const supplemental: Record<string, Record<string, string>> = {
    en: {
        'Cannot find footnote definition': 'Cannot find footnote definition',
        'Input the footnote definition...': 'Input the footnote definition...',
        'Go to': 'Go to', 'Create': 'Create',
        'edit': 'Edit', 'delete block': 'Delete Block',
        'Empty HTML Block': 'Empty HTML Block', 'OK': 'OK', 'Flowchart': 'Flowchart', 'Sequence': 'Sequence',
    },
    'zh-CN': {
        'Cannot find footnote definition': '找不到脚注定义',
        'Input the footnote definition...': '输入脚注定义...',
        'Go to': '跳转', 'Create': '创建',
        'edit': '编辑', 'delete block': '删除块',
        'Empty HTML Block': '空 HTML 块', 'OK': '确定', 'Flowchart': '流程图', 'Sequence': '时序图',
    },
};
