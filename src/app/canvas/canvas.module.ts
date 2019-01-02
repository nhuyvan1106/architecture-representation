import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CanvasComponent } from './canvas.component';
import { ColumnComponent } from './views/column/column.component';
import { SharedModule } from '@shared/shared.module';
import { LinksComponent } from './views/links/links.component';
import { HighlighterDirective } from './views/highlighter.directive';
import { TextEditorComponent } from './views/text-editor/text-editor.component';
import { ColorPickerComponent } from './views/color-picker/color-picker.component';
import { CellComponent } from './views/cell/cell.component';
import { CellGroupComponent } from './views/cell-group/cell-group.component';

@NgModule({
  declarations: [CanvasComponent, ColumnComponent, LinksComponent, HighlighterDirective, TextEditorComponent, ColorPickerComponent, CellComponent, CellGroupComponent],
  imports: [
    CommonModule,
    SharedModule
  ],
  exports: [CanvasComponent],
  entryComponents: [TextEditorComponent, ColorPickerComponent]
})
export class CanvasModule { }
