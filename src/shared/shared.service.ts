import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ActivityLog } from 'src/entity/activity-log.entity';
import { ActivityType } from 'src/entity/activity-type.entity';
import { CareerType } from 'src/entity/career-type.entity';
import { Report } from 'src/entity/report.entity';
import { ReviewHashtag } from 'src/entity/review-hashtag.entity';
import { Subscribe } from 'src/entity/subscribe.entity';
import { User } from 'src/entity/user.entity';
import { UtilService } from 'src/util/util.service';
import { Repository } from 'typeorm';
import { ReportCreateDto } from './dto/report-create.dto';
import { SubscribeCreateDto } from './dto/subscribe-create.dto';

@Injectable()
export class SharedService {
  constructor(
    @InjectRepository(CareerType)
    private readonly careerTypeRepository: Repository<CareerType>,
    @InjectRepository(ReviewHashtag)
    private readonly reviewHashtagRepository: Repository<ReviewHashtag>,
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
    @InjectRepository(ActivityType)
    private readonly activityTypeRepository: Repository<ActivityType>,
    @InjectRepository(ActivityLog)
    private readonly activityLogRepository: Repository<ActivityLog>,
    @InjectRepository(Subscribe)
    private readonly subscribeRepository: Repository<Subscribe>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly utilService: UtilService,
  ) {}

  async getCareerType() {
    const careerType = await this.careerTypeRepository.find();

    return careerType;
  }

  async getHashtag() {
    const hashtag = await this.reviewHashtagRepository.find();

    return hashtag;
  }

  async createReport(user_id: number, reportCreateDto: ReportCreateDto) {
    if (user_id !== reportCreateDto.user_id) {
      throw new HttpException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }
    const report = await this.reportRepository.create(reportCreateDto);
    const response = await this.reportRepository.save(report);
    const savedReport = await this.reportRepository.findOne({ where: { id: response.id }, relations: ['user'] });
    const slackMsg = `
=======유저 일반 신고=======
신고자 : ${savedReport.user.user_id}
신고유형 : ${savedReport.report_type}
신고사유 : ${savedReport.comment}
신고대상 : ${savedReport.target}
신고대상 번호 : ${savedReport.target_id}
`;
    if (response.id) {
      this.utilService.slackWebHook('report', slackMsg);
      return { msg: '신고완료' };
    } else {
      throw new HttpException('BAD_REQUEST', HttpStatus.BAD_REQUEST);
    }
  }

  async addPoint(userId: number, type: number, reason?: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new HttpException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const activityType = await this.activityTypeRepository.findOne({ where: { id: type } });
    //출석일 경우 중복 제외
    if (type === 2) {
      const today = new Date().toISOString().split('T')[0];
      const log = await this.activityLogRepository
        .createQueryBuilder('log')
        .where('log.user_id = :userId', { userId })
        .andWhere('log.type_id = :type', { type })
        .andWhere('DATE(log.created_at) = :today', { today })
        .andWhere('log.is_del = false')
        .getOne();
      if (log) {
        return;
      }
    }
    //개인정보 추가일 경우 중복 제외
    else if (type === 8) {
      const log = await this.activityLogRepository.findOne({ where: { user: { id: userId }, type: { id: type }, is_del: false } });
      console.log(log);
      if (log) {
        return;
      }
    }

    const newLog = await this.activityLogRepository.create({ user: user, type: activityType, reason: reason || null });
    await this.activityLogRepository.save(newLog);

    this.updateTotalPoint(userId);
  }

  async revokePoint(userId: number, type: number, reason?: string) {
    const log = await this.activityLogRepository.findOne({ where: { user: { id: userId }, type: { id: type }, reason: reason || null, is_del: false } });
    if (log) {
      log.is_del = true;
      await this.activityLogRepository.save(log);
      this.updateTotalPoint(userId);
    }
  }

  async updateTotalPoint(userId: number) {
    let totalPoints = 0;
    const activityLog = await this.activityLogRepository.find({ where: { user: { id: userId }, is_del: false }, relations: ['type'] });
    activityLog.map(log => (totalPoints += log.type.point));

    await this.userRepository.update(userId, {
      activity_points: totalPoints,
      modified_date: () => 'modified_date',
    });
  }

  async subscribe(subscribeCreateDto: SubscribeCreateDto) {
    const newSubscribe = await this.subscribeRepository.create(subscribeCreateDto);
    await this.subscribeRepository.save(newSubscribe);
    return newSubscribe;
  }
}
