import type {ThemeConfig} from 'antd';

export const palette = {
  background:'#f5f7fa', surface:'#ffffff', surfaceSubtle:'#f8fafb', canvas:'#eff3f7',
  text:'#1c3042', textSecondary:'#526477', textMuted:'#5c6d80',
  border:'#dce4ec', borderStrong:'#b9c8d5',
  primary:'#146b64', primaryHover:'#0c5752', primarySoft:'#eaf5f2',
  success:'#256548', successSoft:'#eef7f1', warning:'#8b5e17', warningSoft:'#fff8e9',
  error:'#b13932', errorSoft:'#fff2f0', info:'#285eab', infoSoft:'#edf4ff',
} as const;

export const fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';

export const sciNodeTheme:ThemeConfig = {
  token:{
    fontFamily, fontSize:14, controlHeight:36, borderRadius:8,
    colorPrimary:palette.primary, colorSuccess:palette.success, colorWarning:palette.warning,
    colorError:palette.error, colorInfo:palette.info, colorText:palette.text,
    colorTextSecondary:palette.textSecondary, colorTextTertiary:palette.textMuted,
    colorTextPlaceholder:palette.textMuted, colorTextDisabled:palette.textMuted,
    colorBgLayout:palette.background, colorBgContainer:palette.surface, colorBorder:palette.border,
    colorSuccessText:palette.success, colorWarningText:palette.warning,
    colorErrorText:palette.error, colorInfoText:palette.info,
    boxShadow:'0 12px 40px rgba(28,48,66,.10)',
  },
  components:{
    Button:{fontWeight:500,primaryShadow:'none',defaultShadow:'none'},
    Modal:{borderRadiusLG:16},Card:{borderRadiusLG:12},Drawer:{footerPaddingBlock:16},
    Tabs:{horizontalItemGutter:24},Select:{optionSelectedBg:palette.primarySoft},
  },
};

export function applyThemeVariables(root:HTMLElement){
  for(const [key,value] of Object.entries(palette)){
    root.style.setProperty(`--${key.replace(/[A-Z]/g,letter=>`-${letter.toLowerCase()}`)}`,value);
  }
  root.style.setProperty('--font-ui',fontFamily);
}
