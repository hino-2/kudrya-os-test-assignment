import { IsInt, Min } from 'class-validator';

export class ControlRestockDto {
  @IsInt()
  @Min(0)
  count!: number;
}
